import type { LearningArchitectureBrief } from '../learning-architecture/analyzePage'
import {
  findUnlabelledCodeFences,
  findUnsupportedLessonCallouts,
  hasInventedLessonCardContainer,
} from '@/lib/lesson-cards'
import type { TopicPagePlan } from '../learning-architecture/analyzeTopicPlan'
import type { GeneratedTopicPage } from './generateTopicPage'
import type { CourseContinuityContext } from './courseContinuity'

export type LessonQualityDimension =
  | 'correctness'
  | 'target_understanding'
  | 'prerequisite_fit'
  | 'explanation_quality'
  | 'example_relevance'
  | 'continuity'
  | 'coverage'
  | 'cognitive_load'
  | 'source_faithfulness'

export type LessonQualityIssue = {
  code: string
  dimension: LessonQualityDimension
  severity: 'critical' | 'warning'
  message: string
}

export type LessonQualityReport = {
  version: 'lesson-quality-v2'
  accepted: boolean
  overall_score: number
  threshold: number
  dimensions: Record<LessonQualityDimension, number>
  issues: LessonQualityIssue[]
  evaluated_at: Date
}

export type LessonQualityRepairRecord = {
  attempt: number
  trigger_score: number
  issues: LessonQualityIssue[]
  created_at: Date
}

/**
 * Hard blocks: the page is broken or unsafe and must never reach the learner,
 * no matter how high it scores. Every OTHER critical issue is a quality signal
 * already folded into the weighted score — a complete page that still clears
 * THRESHOLD despite one is good enough to serve rather than something to
 * dead-end a course on. (Policy chosen by the founder: keep hard blocks for
 * broken/unsafe pages, let high-scoring pages through stylistic criticals.)
 */
export const HARD_BLOCK_CODES = new Set([
  'missing_substantive_core',    // no real explanation on the page
  'unfinished_content',          // placeholder / TODO text leaked through
  'source_verification_missing', // source-grounded page without verified citations
  'source_narration',            // teach the knowledge; never report what the source says
  'soft_page_limit_exceeded',    // physical page overflow must continue on the next page
  'planned_page_underfilled',    // do not leave avoidable space while material continues
  'premature_page_closure',      // a physical page break is not a lesson conclusion
  'concept_heading_missing',     // major concepts must remain visible and navigable
  'concept_heading_unclear',     // sentence-like or generic headings defeat scanning
  'dependency_connection_missing', // declared taught prerequisites must be connected in prose
  'dependency_conflation',       // distinct prerequisite/current processes cannot be equated
  'formal_definition_missing',   // planner explicitly required a formal definition
  'required_example_missing',    // required worked evidence cannot be replaced by exposition alone
  'misconception_coverage_missing', // high-risk wrong beliefs must be corrected explicitly
  'internal_repetition',         // repeated paragraphs create false fluency and waste the page
  'hard_stamp_missing',          // planner-required durable insight must be visible, not implied
  'hard_stamp_incomplete',       // the callout must contain the mapping and its boundary
  'unsupported_lesson_card',     // generated pages may use only the renderer-owned card grammar
  'unlabelled_code_card',        // fenced code must declare its language for useful rendering
  'lesson_card_overuse',         // excessive cards turn the manuscript into a dashboard
])

/**
 * A learner sees this when a page is rejected. The old message —
 * "failed the quality contract with score 92/75" — was actively misleading: a
 * page could clear the score bar and still be rejected by a critical issue, so
 * the passing-looking number next to the word "failed" read like a math error.
 * This states the real reason instead.
 */
export function lessonQualityRejectionReason(report: LessonQualityReport): string {
  const hardBlock = report.issues.find((issue) => HARD_BLOCK_CODES.has(issue.code))
  if (hardBlock) {
    return `The generated lesson didn't pass a required check: ${hardBlock.message}`
  }
  const topCritical = report.issues
    .filter((issue) => issue.severity === 'critical')
    .slice(0, 2)
    .map((issue) => issue.message)
  const detail = topCritical.length ? ` Main gaps: ${topCritical.join(' ')}` : ''
  return `The generated lesson scored ${report.overall_score}/${report.threshold}, below the quality bar.${detail}`
}

export class LessonQualityError extends Error {
  readonly code = 'LESSON_QUALITY_REJECTED'
  readonly report: LessonQualityReport

  constructor(report: LessonQualityReport) {
    super(lessonQualityRejectionReason(report))
    this.name = 'LessonQualityError'
    this.report = report
  }
}

type EvaluationInput = {
  page: GeneratedTopicPage
  topic: any
  pageNumber: number
  previousPages?: any[]
  architecture?: LearningArchitectureBrief
  pagePlan?: TopicPagePlan | null
  sourceGrounded?: boolean
  continuity?: CourseContinuityContext
}

const THRESHOLD = 75
const WORD_TARGETS = {
  micro: { min: 70, max: 500 },
  short: { min: 140, max: 850 },
  full: { min: 280, max: 1_650 },
  critical: { min: 450, max: 2_100 },
} as const

function plainText(value: unknown) {
  return String(value ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_$|~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(value: unknown) {
  return new Set(
    plainText(value)
      .toLowerCase()
      .match(/[\p{L}\p{N}_+#.-]+/gu)
      ?.map((token) => token.replace(/^[.-]+|[.-]+$/g, ''))
      .filter((token) => token.length >= 4) ?? [],
  )
}

function overlap(left: unknown, right: unknown) {
  const a = tokens(left)
  const b = tokens(right)
  if (!a.size || !b.size) return 0
  let matches = 0
  for (const token of a) if (b.has(token)) matches += 1
  return matches / a.size
}

function paragraphSimilarity(content: string) {
  const paragraphs = content
    .split(/\n{2,}/)
    .map(plainText)
    .filter((paragraph) => paragraph.length >= 80)
  let highest = 0
  for (let left = 0; left < paragraphs.length; left += 1) {
    for (let right = left + 1; right < paragraphs.length; right += 1) {
      const a = tokens(paragraphs[left])
      const b = tokens(paragraphs[right])
      if (!a.size || !b.size) continue
      let intersection = 0
      for (const token of a) if (b.has(token)) intersection += 1
      const union = a.size + b.size - intersection
      highest = Math.max(highest, union ? intersection / union : 0)
    }
  }
  return highest
}

function conceptHeadings(content: string) {
  return Array.from(content.matchAll(/^##\s+(.+)$/gm))
    .map((match) => match[1].replace(/\s+#+\s*$/, '').trim())
    .filter(Boolean)
}

function unclearConceptHeading(heading: string) {
  const normalized = heading.replace(/[*_`]/g, '').trim()
  const generic = /^(introduction|overview|core concepts?|explanation|background|summary|conclusion|what comes next)$/i
  const sentenceLike = /[.?!]\s*$/.test(normalized)
    || /^(what|why|how|when|where|suppose|imagine)\b/i.test(normalized)
    || normalized.split(/\s+/).length > 10
  return generic.test(normalized) || sentenceLike
}

function hasExample(page: GeneratedTopicPage) {
  const exampleSection = page.sections.some(
    (section) => section.type === 'examples' && plainText(section.content).length >= 60,
  )
  return exampleSection
    || Boolean(page.example_to_use)
    || /\b(for example|worked example|consider the case|take the case|suppose we have|here is a concrete)\b/i.test(page.content)
    || /```[\s\S]+```/.test(page.content)
}

function hasExplanatoryReasoning(content: string) {
  return /\b(because|therefore|which means|the reason|this happens when|as a result|so that|leads to|depends on|the key is)\b/i.test(content)
}

function hasContinuitySignal(page: GeneratedTopicPage) {
  return page.reused_concepts.length > 0
    || page.reminder_concepts.length > 0
    || page.example_refs.length > 0
    || /\b(earlier|previously|building on|from the last page|you already know|return to|continue the)\b/i.test(page.content)
}

function normalizePhrase(value: unknown) {
  return plainText(value).toLowerCase().replace(/[^a-z0-9+#.]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function mentionsConcept(content: string, concept: string) {
  const normalizedContent = normalizePhrase(content)
  const normalizedConcept = normalizePhrase(concept)
  return Boolean(normalizedConcept) && normalizedContent.includes(normalizedConcept)
}

function hasRelationshipLanguage(content: string) {
  return /\b(uses?|provides?|produces?|computes?|calculates?|supplies?|feeds?|passes?|depends? on|builds? on|enables?|updates?|applies?|consumes?|while|whereas|by contrast|distinct|different role|not the same)\b/i.test(content)
}

function hardStampCallout(content: string) {
  const match = content.match(/(?:^|\n)>\s*\*\*Lock this in:\*\*\s*([^\n]*(?:\n>\s*[^\n]*)*)/i)
  return match?.[1]?.replace(/^>\s*/gm, ' ').replace(/\s+/g, ' ').trim() ?? ''
}

function conflatesConcepts(content: string, left: string, right: string) {
  const leftTerm = escapeRegex(normalizePhrase(left))
  const rightTerm = escapeRegex(normalizePhrase(right))
  if (!leftTerm || !rightTerm) return false
  const identity = '(?:is|means|equals|is simply|is just|is the same as|is another name for)'
  return new RegExp(`\\b${leftTerm}\\b\\s+${identity}\\s+\\b${rightTerm}\\b`, 'i').test(normalizePhrase(content))
    || new RegExp(`\\b${rightTerm}\\b\\s+${identity}\\s+\\b${leftTerm}\\b`, 'i').test(normalizePhrase(content))
}

function addIssue(
  issues: LessonQualityIssue[],
  dimension: LessonQualityDimension,
  code: string,
  severity: LessonQualityIssue['severity'],
  message: string,
) {
  issues.push({ code, dimension, severity, message })
}

type OpeningIssue = { code: string; message: string }

function evaluateOpening(page: GeneratedTopicPage, pageNumber: number, pageRole?: string | null): OpeningIssue[] {
  const opening = page.content
    .replace(/^#{1,6}\s+.*$/gm, '')
    .replace(/^>\s?.*$/gm, '')
    .split(/\n{2,}/)
    .map((block) => block.replace(/\s+/g, ' ').trim())
    .find(Boolean)
    ?.slice(0, 700) ?? ''
  const issues: OpeningIssue[] = []
  if (!opening) return [{ code: 'OPENING_MISSING', message: 'The lesson has no substantive opening paragraph.' }]

  if (
    /\b(the|this|your) (source|document|material|notes?)\b|\baccording to (the|this|your) (source|document|material|notes?)\b/i.test(opening)
  ) {
    issues.push({ code: 'OPENING_NARRATES_SOURCE', message: 'The opening comments on source material instead of teaching the idea directly.' })
  }
  if (
    /^(suppose|imagine|picture this|think about|consider this|have you ever wondered|what if you wanted to)\b/i.test(opening)
  ) {
    issues.push({ code: 'OPENING_CANNED_HOOK', message: 'The opening uses a canned hypothetical hook instead of beginning with substantive insight.' })
  }

  const isIntro = pageNumber === 1 && (!pageRole || pageRole === 'introduce')
  if (
    isIntro
    && /\b(spam filter|spam and non spam|cats? (?:versus|vs\.?|and) dogs?|house prices?|movie recommendations?|netflix recommendations?|recogniz(?:e|ing) faces?|self driving cars?)\b/i.test(opening)
  ) {
    issues.push({ code: 'OPENING_STOCK_EXAMPLE', message: 'The opening relies on an overused stock example rather than the most revealing framing for this concept.' })
  }
  if (
    /\b(in this (page|lesson)|this (page|lesson) (?:will|covers)|before we (?:begin|dive in)|welcome to)\b/i.test(opening)
  ) {
    issues.push({ code: 'OPENING_THROAT_CLEARING', message: 'The opening contains throat-clearing instead of immediately teaching.' })
  }

  return issues
}

function architectureMismatches(
  page: GeneratedTopicPage,
  brief: LearningArchitectureBrief,
) {
  const errors: string[] = []
  const explicitMisconceptionCorrection = /\b(mistake|misconception|confus|pitfall|wrong|not the same|contrast|breaks|separat(?:e|ion)|distinct|different (?:job|role|process))\b/i.test(page.content)
    || (page.concept_connections ?? []).some((connection) => plainText(connection.distinction).length >= 24)
    || (page.hard_stamped_insights ?? []).some((stamp) =>
      stamp.kind === 'distinction' || plainText(stamp.boundary).length >= 24
    )
  if (page.content_kind !== brief.recommended_content_kind) {
    errors.push(`Generated content_kind "${page.content_kind}" ignored architecture recommendation "${brief.recommended_content_kind}".`)
  }
  if (
    brief.example_strategy.worked_example_needed
    && page.should_generate_page
    && !hasExample(page)
  ) {
    errors.push('Architecture required a worked example, but generated page has no clear example.')
  }
  if (
    brief.likely_misconceptions.length
    && page.should_generate_page
    && !explicitMisconceptionCorrection
  ) {
    errors.push('Architecture identified misconception risk, but generated page does not address it.')
  }
  return errors
}

export function evaluateLessonQuality({
  page,
  topic,
  pageNumber,
  previousPages = [],
  architecture,
  pagePlan,
  sourceGrounded = false,
  continuity,
}: EvaluationInput): LessonQualityReport {
  const issues: LessonQualityIssue[] = []
  const content = plainText(page.content)
  const wordCount = content.split(/\s+/).filter(Boolean).length
  const dimensions: Record<LessonQualityDimension, number> = {
    correctness: 90,
    target_understanding: 100,
    prerequisite_fit: 100,
    explanation_quality: 100,
    example_relevance: 100,
    continuity: 100,
    coverage: 100,
    cognitive_load: 100,
    source_faithfulness: 100,
  }

  const unsupportedCallouts = findUnsupportedLessonCallouts(page.content)
  if (unsupportedCallouts.length || hasInventedLessonCardContainer(page.content)) {
    dimensions.explanation_quality = Math.min(dimensions.explanation_quality, 25)
    addIssue(
      issues,
      'explanation_quality',
      'unsupported_lesson_card',
      'critical',
      unsupportedCallouts.length
        ? `The page invented or reused unsupported cards (${unsupportedCallouts.join(', ')}). Use only Definition, Example, fenced Code, and Lock this in.`
        : 'The page created a custom HTML, MDX, or ::: card container. Card presentation belongs to the renderer.',
    )
  }

  if (findUnlabelledCodeFences(page.content) > 0) {
    dimensions.explanation_quality = Math.min(dimensions.explanation_quality, 45)
    addIssue(
      issues,
      'explanation_quality',
      'unlabelled_code_card',
      'critical',
      'Every fenced code card needs an explicit language so syntax and the card header render correctly.',
    )
  }

  const sanctionedCallouts = page.content.match(/(?:^|\n)\s*>\s*\*\*(?:Definition|Example|Lock this in):\*\*/gi) ?? []
  const lockInCards = page.content.match(/(?:^|\n)\s*>\s*\*\*Lock this in:\*\*/gi) ?? []
  if (sanctionedCallouts.length > 4 || lockInCards.length > 1) {
    dimensions.cognitive_load = Math.min(dimensions.cognitive_load, 35)
    addIssue(
      issues,
      'cognitive_load',
      'lesson_card_overuse',
      'critical',
      'The page overuses emphasis cards. Keep at most four sanctioned callouts and only one Lock this in card per physical page.',
    )
  }

  if (content.length < 250 || !page.sections.some((section) => section.type === 'core')) {
    dimensions.correctness = 35
    addIssue(issues, 'correctness', 'missing_substantive_core', 'critical',
      'The page has no sufficiently developed core explanation.')
  }
  if (/\b(TODO|TBD|insert example|placeholder|lorem ipsum)\b/i.test(page.content)) {
    dimensions.correctness = Math.min(dimensions.correctness, 30)
    addIssue(issues, 'correctness', 'unfinished_content', 'critical',
      'The lesson contains unfinished or placeholder content.')
  }

  const target = architecture?.target_understanding || page.core_realization || page.focus
  const targetOverlap = overlap(target, `${page.summary} ${page.core_realization ?? ''} ${page.content}`)
  if (!page.core_realization && !architecture?.target_understanding) {
    dimensions.target_understanding = 45
    addIssue(issues, 'target_understanding', 'missing_target', 'critical',
      'The lesson does not declare a concrete realization or target understanding.')
  } else if (targetOverlap < 0.25) {
    dimensions.target_understanding = 55
    addIssue(issues, 'target_understanding', 'target_not_taught', 'critical',
      'The stated learning target is not visibly developed in the lesson.')
  }

  const requiredPrior = architecture?.required_prior_knowledge ?? []
  const repairs = architecture?.prior_knowledge_repair ?? []
  if (repairs.length) {
    const repairCoverage = repairs.filter((repair) => overlap(repair, page.content) >= 0.2).length
    if (repairCoverage === 0) {
      dimensions.prerequisite_fit = 55
      addIssue(issues, 'prerequisite_fit', 'prerequisite_repair_missing', 'critical',
        'The architecture required a prerequisite repair, but the lesson does not provide it.')
    }
  } else if (requiredPrior.length && pageNumber === 1 && !page.sections.some((section) => section.type === 'prerequisites')) {
    dimensions.prerequisite_fit = 80
  }

  const requiredConnections = continuity?.connections.filter((connection) => connection.required_in_explanation) ?? []
  for (const connection of requiredConnections) {
    const mentionsSource = mentionsConcept(page.content, connection.source_topic_title)
    const mentionsTarget = mentionsConcept(page.content, connection.target_topic_title)
    const explicitRelationship = mentionsSource && mentionsTarget && hasRelationshipLanguage(page.content)
    if (!explicitRelationship) {
      dimensions.prerequisite_fit = Math.min(dimensions.prerequisite_fit, 35)
      dimensions.continuity = Math.min(dimensions.continuity, 25)
      addIssue(
        issues,
        'continuity',
        'dependency_connection_missing',
        'critical',
        `The lesson must explicitly connect ${connection.source_topic_title} to ${connection.target_topic_title}, distinguish their roles, and explain the handoff between them.`,
      )
    }
    if (conflatesConcepts(page.content, connection.source_topic_title, connection.target_topic_title)) {
      dimensions.correctness = Math.min(dimensions.correctness, 20)
      dimensions.continuity = Math.min(dimensions.continuity, 20)
      addIssue(
        issues,
        'correctness',
        'dependency_conflation',
        'critical',
        `${connection.source_topic_title} and ${connection.target_topic_title} are distinct concepts, but the lesson states or strongly implies that they are the same process.`,
      )
    }
  }

  if (requiredConnections.length) {
    const declared = page.concept_connections ?? []
    const declaredAll = requiredConnections.every((connection) => declared.some((item) =>
      normalizePhrase(item.prior_concept) === normalizePhrase(connection.source_topic_title)
      && normalizePhrase(item.current_concept) === normalizePhrase(connection.target_topic_title)
      && plainText(item.relationship).length >= 20
      && plainText(item.distinction).length >= 12
    ))
    if (!declaredAll) {
      dimensions.continuity = Math.min(dimensions.continuity, 70)
      addIssue(issues, 'continuity', 'connection_metadata_incomplete', 'warning',
        'The prose may contain a bridge, but its structured concept_connections record is missing or incomplete.')
    }
  }

  const requiredHardStamp = architecture?.hard_stamp
  if (requiredHardStamp) {
    const stamped = hardStampCallout(page.content)
    if (!stamped) {
      dimensions.coverage = Math.min(dimensions.coverage, 20)
      addIssue(issues, 'coverage', 'hard_stamp_missing', 'critical',
        'The learning architecture requires a hard-stamped insight, but the page never presents a visible "Lock this in" callout.')
    } else {
      const namesCurrent = mentionsConcept(stamped, requiredHardStamp.current_concept)
      const namesPrior = !requiredHardStamp.prior_concept
        || mentionsConcept(stamped, requiredHardStamp.prior_concept)
      const explainsMapping = requiredHardStamp.mapping_steps.some((step) =>
        overlap(step, stamped) >= 0.2
      ) || hasRelationshipLanguage(stamped)
      const statesBoundary = !requiredHardStamp.boundary
        || overlap(requiredHardStamp.boundary, stamped) >= 0.18
        || /\b(but|however|only|not|unlike|does not|stops? (?:at|being)|boundary|limit)\b/i.test(stamped)
      if (!namesCurrent || !namesPrior || !explainsMapping || !statesBoundary) {
        dimensions.coverage = Math.min(dimensions.coverage, 35)
        addIssue(issues, 'coverage', 'hard_stamp_incomplete', 'critical',
          'The hard-stamped insight does not explicitly name the mapped concepts, explain their operational correspondence, and state the limit when required.')
      }
    }

    const declared = page.hard_stamped_insights ?? []
    const matchingRecord = declared.some((item) =>
      normalizePhrase(item.current_concept) === normalizePhrase(requiredHardStamp.current_concept)
      && (!requiredHardStamp.prior_concept
        || normalizePhrase(item.prior_concept) === normalizePhrase(requiredHardStamp.prior_concept))
      && plainText(item.statement).length >= 24
      && plainText(item.mapping).length >= 20
      && (!requiredHardStamp.boundary || plainText(item.boundary).length >= 12)
    )
    if (!matchingRecord) {
      dimensions.continuity = Math.min(dimensions.continuity, 70)
      addIssue(issues, 'continuity', 'hard_stamp_metadata_missing', 'warning',
        'A required hard stamp needs a matching structured record so later pages can retrieve and reuse the learner’s mental model.')
    }
  }

  if (continuity?.unmet_prerequisites.length) {
    const falselyAssumesKnowledge = /\b(as you (?:already )?know|you already learned|we already covered|recall that)\b/i.test(page.content)
    const hasRepair = page.sections.some((section) => section.type === 'prerequisites')
      || continuity.unmet_prerequisites.some((concept) => mentionsConcept(page.content, concept))
    if (falselyAssumesKnowledge || !hasRepair) {
      dimensions.prerequisite_fit = Math.min(dimensions.prerequisite_fit, 45)
      addIssue(issues, 'prerequisite_fit', 'unmet_prerequisite_assumed', 'critical',
        'The curriculum contains an unmet prerequisite; the lesson must repair it briefly instead of treating it as learned knowledge.')
    }
  }

  const reasoningRequired = architecture?.page_sequence_role !== 'practice'
    && architecture?.page_sequence_role !== 'review'
  if (reasoningRequired && !hasExplanatoryReasoning(page.content)) {
    dimensions.explanation_quality = 55
    addIssue(issues, 'explanation_quality', 'facts_without_reasoning', 'critical',
      'The lesson states information without enough causal or explanatory reasoning.')
  }
  if (!page.core_realization || plainText(page.core_realization).length < 20) {
    dimensions.explanation_quality = Math.min(dimensions.explanation_quality, 70)
    addIssue(issues, 'explanation_quality', 'weak_mental_model', 'warning',
      'The lesson lacks a durable mental model or takeaway.')
  }

  if (architecture?.requires_formal_definition) {
    const title = String(topic?.title ?? '')
    const hasDefinitionCallout = />\s*\*\*(?:Definition|Formal definition):\*\*/i.test(page.content)
    const hasDirectDefinition = title
      ? new RegExp(`\\b${escapeRegex(normalizePhrase(title))}\\b\\s+(?:is|means|refers to)\\b`, 'i').test(normalizePhrase(page.content))
      : false
    if (!hasDefinitionCallout && !hasDirectDefinition) {
      dimensions.coverage = Math.min(dimensions.coverage, 30)
      addIssue(issues, 'coverage', 'formal_definition_missing', 'critical',
        'The learning architecture requires a precise formal definition, but the page never states one.')
    }
  }
  const mathRequired = architecture?.representation_plan.some((representation) =>
    /\b(math|formula|equation|derivation)\b/i.test(representation)
  )
  if (mathRequired && !/\$[^$]+\$|\$\$[\s\S]+?\$\$/.test(page.content)) {
    dimensions.coverage = Math.min(dimensions.coverage, 60)
    addIssue(issues, 'coverage', 'planned_formula_missing', 'warning',
      'The architecture calls for a mathematical representation, but the page contains no rendered formula or equation.')
  }

  const exampleRequired = Boolean(architecture?.example_strategy.worked_example_needed)
  const examplePresent = hasExample(page)
  if (exampleRequired && !examplePresent) {
    dimensions.example_relevance = 35
    addIssue(issues, 'example_relevance', 'required_example_missing', 'critical',
      'The learning architecture requires a worked example, but none is present.')
  } else if (examplePresent) {
    const relevance = overlap(
      `${page.focus} ${topic?.title ?? ''} ${page.key_concepts.join(' ')}`,
      `${page.example_to_use ?? ''} ${page.content}`,
    )
    if (relevance < 0.15) {
      dimensions.example_relevance = 65
      addIssue(issues, 'example_relevance', 'example_weakly_connected', 'warning',
        'The example is not clearly connected to the page focus.')
    }
  }

  if (
    pageNumber > 1
    && previousPages.length
    && !pagePlan
    && !hasContinuitySignal(page)
  ) {
    dimensions.continuity = 60
    addIssue(issues, 'continuity', 'continuity_missing', 'warning',
      'The page does not visibly build on the preceding lesson sequence.')
  }
  const previousText = previousPages.map((previous) => previous.content ?? previous.summary ?? '').join(' ')
  if (previousText && overlap(content, previousText) > 0.62) {
    dimensions.continuity = 35
    addIssue(issues, 'continuity', 'previous_page_repetition', 'critical',
      'The lesson substantially repeats material from previous pages.')
  }
  if (
    pagePlan?.continues_to_next
    && /\b(in summary|to summarize|the key takeaway|you now understand|can you explain|before moving on|next, we will|on the next page|in the next page)\b/i
      .test(content.slice(-900))
  ) {
    dimensions.continuity = Math.min(dimensions.continuity, 55)
    addIssue(issues, 'continuity', 'premature_page_closure', 'critical',
      'The page concludes or previews even though the planned explanation continues onto the next physical page.')
  }
  if (pagePlan) {
    const headings = conceptHeadings(page.content)
    const startsConcept = !pagePlan.continues_from_previous
    const introducesAnotherConcept = pagePlan.concepts.length > 1
    if ((startsConcept || introducesAnotherConcept) && headings.length === 0) {
      dimensions.cognitive_load = Math.min(dimensions.cognitive_load, 45)
      addIssue(issues, 'cognitive_load', 'concept_heading_missing', 'critical',
        'A major concept begins without a clear concept-name heading.')
    } else if (headings.some(unclearConceptHeading)) {
      dimensions.cognitive_load = Math.min(dimensions.cognitive_load, 55)
      addIssue(issues, 'cognitive_load', 'concept_heading_unclear', 'critical',
        'A major heading is generic or sentence-like instead of naming the concept directly.')
    }
  }

  const openingIssues = evaluateOpening(page, pageNumber, architecture?.page_sequence_role)
  if (openingIssues.length) {
    dimensions.cognitive_load -= Math.min(45, openingIssues.length * 20)
    for (const openingIssue of openingIssues) {
      addIssue(issues, 'cognitive_load', openingIssue.code, 'critical', openingIssue.message)
    }
  }
  const duplicateSimilarity = paragraphSimilarity(page.content)
  if (duplicateSimilarity >= 0.86) {
    dimensions.cognitive_load = Math.min(dimensions.cognitive_load, 40)
    addIssue(issues, 'cognitive_load', 'internal_repetition', 'critical',
      'Multiple paragraphs repeat nearly the same explanation.')
  } else if (duplicateSimilarity >= 0.72) {
    dimensions.cognitive_load = Math.min(dimensions.cognitive_load, 70)
    addIssue(issues, 'cognitive_load', 'paragraph_overlap', 'warning',
      'Two paragraphs reuse unusually similar vocabulary; compact them if they make the same teaching move.')
  }
  const longestParagraph = page.content
    .split(/\n{2,}/)
    .map((paragraph) => plainText(paragraph).split(/\s+/).filter(Boolean).length)
    .reduce((max, count) => Math.max(max, count), 0)
  if (longestParagraph > 110) {
    dimensions.cognitive_load = Math.min(dimensions.cognitive_load, 65)
    addIssue(issues, 'cognitive_load', 'oversized_paragraph', 'warning',
      'A paragraph is too long to process comfortably.')
  }
  const proseParagraphs = page.content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) =>
      plainText(paragraph).split(/\s+/).filter(Boolean).length >= 35
      && !/^(```|#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\|)/m.test(paragraph)
    )
  if (proseParagraphs.length >= 7 && wordCount > 450) {
    dimensions.cognitive_load = Math.min(dimensions.cognitive_load, 72)
    addIssue(issues, 'cognitive_load', 'prose_heavy_page', 'warning',
      'The page relies on too many prose paragraphs instead of scannable structure; preserve purposeful persona hooks, but compact any prose that is only setup or repetition.')
  }
  if (pagePlan) {
    const usefulMinimum = Math.round(pagePlan.target_words * 0.4)
    if (wordCount < usefulMinimum && pagePlan.continues_to_next) {
      dimensions.cognitive_load = Math.min(dimensions.cognitive_load, 55)
      addIssue(issues, 'cognitive_load', 'planned_page_underfilled', 'critical',
        'The page stops before enough assigned understanding is developed, even though substantive material continues.')
    } else if (wordCount > pagePlan.soft_max_words) {
      const allowedLimit = pagePlan.continues_to_next
        ? pagePlan.soft_max_words * 1.12
        : pagePlan.soft_max_words * 1.25

      if (wordCount > allowedLimit) {
        dimensions.cognitive_load = Math.min(dimensions.cognitive_load, 55)
        addIssue(issues, 'cognitive_load', 'soft_page_limit_exceeded', 'critical',
          `The page exceeds its ${pagePlan.soft_max_words}-word soft maximum instead of breaking at the planned boundary.`)
      }
    }
  } else {
    const inferredMode = page.page_mode
      ?? (page.content_kind === 'full_page' ? 'full' : 'micro')
    const targetRange = WORD_TARGETS[inferredMode]
    if (wordCount < targetRange.min) {
      dimensions.cognitive_load = Math.min(dimensions.cognitive_load, 60)
      addIssue(issues, 'cognitive_load', 'too_shallow', 'critical',
        'The lesson is too short for its planned page mode.')
    } else if (wordCount > targetRange.max) {
      dimensions.cognitive_load = Math.min(dimensions.cognitive_load, 65)
      addIssue(issues, 'cognitive_load', 'page_overloaded', 'warning',
        'The lesson exceeds the useful scope for its planned page mode.')
    }
  }

  if (architecture) {
    for (const message of architectureMismatches(page, architecture)) {
      const critical = /content_kind|required a worked example|misconception risk/i.test(message)
      const code = /misconception risk/i.test(message)
        ? 'misconception_coverage_missing'
        : /worked example/i.test(message)
          ? 'required_example_missing'
          : 'architecture_mismatch'
      addIssue(
        issues,
        critical && /example/i.test(message) ? 'example_relevance' : 'target_understanding',
        code,
        critical ? 'critical' : 'warning',
        message,
      )
      if (critical) {
        if (/example/i.test(message)) dimensions.example_relevance = Math.min(dimensions.example_relevance, 40)
        else dimensions.target_understanding = Math.min(dimensions.target_understanding, 50)
      }
    }
  }

  if (sourceGrounded) {
    if (
      /\b(the|this|your) (source|document|material|notes?|passage|excerpt) (says|uses|identifies|lists|notes|defines|describes|gives|provides|mentions|explains|states|presents|suggests|shows|highlights|outlines|covers|includes|discusses)\b|\baccording to (the|this|your) (source|document|material|notes?)\b/i
        .test(content)
    ) {
      dimensions.explanation_quality = Math.min(dimensions.explanation_quality, 45)
      addIssue(issues, 'explanation_quality', 'source_narration', 'critical',
        'The lesson reports what a source says instead of teaching the supported knowledge directly.')
    }
    const status = page.grounding?.status
    const citations = page.source_citations ?? []
    if ((status !== 'supported' && status !== 'repaired') || citations.length === 0) {
      dimensions.source_faithfulness = 0
      addIssue(issues, 'source_faithfulness', 'source_verification_missing', 'critical',
        'The source-grounded lesson lacks a supported grounding report and valid citations.')
    } else {
      dimensions.source_faithfulness = status === 'repaired' ? 90 : 100
    }
  }

  for (const key of Object.keys(dimensions) as LessonQualityDimension[]) {
    dimensions[key] = Math.max(0, Math.min(100, Math.round(dimensions[key])))
  }
  const weights: Record<LessonQualityDimension, number> = {
    correctness: 0.18,
    target_understanding: 0.14,
    prerequisite_fit: 0.12,
    explanation_quality: 0.14,
    example_relevance: 0.08,
    continuity: 0.12,
    coverage: 0.08,
    cognitive_load: 0.07,
    source_faithfulness: 0.07,
  }
  const overall = Math.round(
    (Object.keys(dimensions) as LessonQualityDimension[])
      .reduce((sum, dimension) => sum + dimensions[dimension] * weights[dimension], 0),
  )
  // Accept when the page clears the score bar AND carries no hard-block issue.
  // Non-hard-block criticals already pulled the weighted score down, so a page
  // that still clears THRESHOLD despite one is good enough to serve.
  const accepted = overall >= THRESHOLD && !issues.some((issue) => HARD_BLOCK_CODES.has(issue.code))

  return {
    version: 'lesson-quality-v2',
    accepted,
    overall_score: overall,
    threshold: THRESHOLD,
    dimensions,
    issues,
    evaluated_at: new Date(),
  }
}

export function buildLessonQualityRepairDirective(
  report: LessonQualityReport,
  previousDraft: GeneratedTopicPage,
) {
  const issueLines = report.issues
    .map((issue) => `- [${issue.severity.toUpperCase()}] ${issue.message}`)
    .join('\n')
  return `LESSON QUALITY REPAIR:
The previous draft scored ${report.overall_score}/${report.threshold} and failed these checks:
${issueLines}

Rewrite the lesson to fix exactly these failures while preserving its page focus, scope, factual content, source citations, and planned content kind.
Do not add unrelated sections or length merely to improve the score.

Previous draft for diagnosis:
---
${previousDraft.content.slice(0, 8_000)}
---`
}
