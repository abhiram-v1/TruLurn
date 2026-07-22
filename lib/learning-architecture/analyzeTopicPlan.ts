import { generateAI, parseAIJson } from '@/lib/ai'
import { buildPlanFidelityDirective, policyFromCourse, type SourceFidelityPolicy } from '@/lib/course-generation/sourceFidelity'
import type { CourseMemoryContext } from '@/lib/vector/retrieval'
import type { ContentKind } from '@/types'
import { VISUAL_REPRESENTATION_PLANNING_RULES } from '@/lib/ai/skills/dataChart'
import {
  normalizeBrief,
  validateLearningArchitectureBrief,
  type LearningArchitectureBrief,
  type PageSequenceRole,
} from './analyzePage'

// One topic-level lesson plan, generated in a SINGLE call on first touch of a
// topic and cached on the topic document. This replaces the per-page architecture
// brief call (N calls → 1 per topic) and improves coherence because the planner
// sees the whole arc at once and can sequence + dedup globally.
//
// The plan is the AUTHORITY on how many pages this topic deserves. The
// curriculum's estimated_pages is only a ceiling — the planner sees the actual
// conceptual load and may consolidate genuinely thin material, but it must
// preserve enough space for definitions, mechanisms, examples, misconceptions,
// and source coverage. The budget is not a target to minimize.

export type PageTargetLength = 'short' | 'medium' | 'long'
export type PageBreakPreference = 'concept_boundary' | 'natural_pause' | 'soft_overflow'

export type TopicPagePlan = {
  page_number: number
  focus: string
  content_kind: ContentKind
  page_sequence_role: PageSequenceRole
  target_length: PageTargetLength
  target_words: number
  soft_max_words: number
  concepts: string[]
  start_boundary: string
  end_boundary: string
  continues_from_previous: boolean
  continues_to_next: boolean
  break_preference: PageBreakPreference
  break_reason: string
  brief: LearningArchitectureBrief | null
}

export type TopicLessonPlan = {
  generated_at: string
  version: number
  estimated_total_words: number
  page_word_target: number
  /** Source fidelity policy key the plan was built under (null for ai_teacher). */
  fidelity_key?: string | null
  /** Planner's one-line justification for the page count. */
  page_count_reason: string
  /** Version fingerprint of the course skill packs used to build this plan. */
  skill_context_key?: string | null
  pages: TopicPagePlan[]
}

// v5: physical pages are consecutive textbook spans, with signal-density
// ceilings rather than prose-comfort targets.
// v6 moves lesson preparation to GPT-5.4 and removes the old bias toward
// minimizing page count.
// v7 adds AI-authored lesson-depth recommendations so model thinking effort can
// start from the planner's judgement instead of hardcoded topic-name rules.
// Untouched cached plans are upgraded lazily.
export const PLAN_VERSION = 7

/**
 * A plan is usable when it matches the current planner contract — and, when an
 * expected fidelity key is supplied, when it was built under the SAME source
 * fidelity policy. This is what makes the system adaptive: a mid-course style
 * or coverage change produces a new key, so topics re-plan on next touch.
 */
export function isPlanCurrent(
  plan: TopicLessonPlan | undefined | null,
  expectedFidelityKey?: string | null,
  expectedSkillContextKey?: string | null,
): plan is TopicLessonPlan {
  if (
    !plan
    || Number(plan.version) < PLAN_VERSION
    || !Array.isArray(plan.pages)
    || plan.pages.length < 1
  ) return false
  if (expectedFidelityKey !== undefined && (plan.fidelity_key ?? null) !== expectedFidelityKey) return false
  if (
    expectedSkillContextKey !== undefined
    && (plan.skill_context_key ?? null) !== expectedSkillContextKey
  ) return false
  return true
}

export function formatPageBoundaryPlan(page: TopicPagePlan) {
  return [
    `Page span: ${page.start_boundary} -> ${page.end_boundary}`,
    `Concept sequence: ${page.concepts.join(' -> ')}`,
    `Word budget: target ${page.target_words}; soft maximum ${page.soft_max_words}`,
    `Continues from previous page: ${page.continues_from_previous ? 'yes' : 'no'}`,
    `Continues onto next page: ${page.continues_to_next ? 'yes' : 'no'}`,
    `Preferred break: ${page.break_preference}`,
    `Break reason: ${page.break_reason}`,
  ].join('\n')
}

function compact(value: unknown, max = 600) {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}...` : clean
}

function normalizeContentKind(value: unknown): ContentKind {
  if (value === 'full_page' || value === 'section' || value === 'bridge' || value === 'example' || value === 'skip') {
    return value
  }
  return 'full_page'
}

function normalizeRole(value: unknown): PageSequenceRole {
  if (
    value === 'introduce' || value === 'deepen' || value === 'connect' ||
    value === 'repair' || value === 'practice' || value === 'review'
  ) return value
  return 'introduce'
}

function normalizeTargetLength(value: unknown, contentKind: ContentKind): PageTargetLength {
  if (value === 'short' || value === 'medium' || value === 'long') return value
  return contentKind === 'full_page' ? 'medium' : 'short'
}

const WORD_BUDGETS: Record<PageTargetLength, { target: number; softMax: number }> = {
  short: { target: 320, softMax: 420 },
  medium: { target: 560, softMax: 680 },
  long: { target: 780, softMax: 920 },
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const number = Math.round(Number(value))
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback
}

function normalizeBreakPreference(value: unknown): PageBreakPreference {
  if (value === 'concept_boundary' || value === 'natural_pause' || value === 'soft_overflow') {
    return value
  }
  return 'natural_pause'
}

function normalizeConcepts(value: unknown, fallback: string) {
  if (!Array.isArray(value)) return [fallback]
  const concepts = value.map((item) => compact(item, 120)).filter(Boolean).slice(0, 8)
  return concepts.length ? concepts : [fallback]
}

function formatMemory(memory?: CourseMemoryContext, sourceMode = false) {
  if (!memory) return 'No retrieved course memory.'
  const pages = memory.pages.slice(0, 3).map((p) => `[${p.topic_title}, p${p.page_number}] ${compact(p.summary || p.content, 240)}`)
  // Source-based courses: the plan distributes the source material across pages,
  // so the planner needs to actually see it — more chunks, bigger excerpts.
  const sources = sourceMode
    ? memory.sourceChunks.slice(0, 6).map((c) => `[${c.source_title ?? 'Source'}] ${compact(c.content, 700)}`)
    : memory.sourceChunks.slice(0, 2).map((c) => `[${c.source_title ?? 'Source'}] ${compact(c.content, 240)}`)
  return [...pages, ...sources].join('\n') || 'No retrieved course memory.'
}

type AnalyzeTopicPlanInput = {
  course: any
  topic: any
  plannedPages: number
  pageFocuses: string[]
  mapPointer?: string
  memory?: CourseMemoryContext
  courseSkillContext?: string
  courseSkillContextKey?: string | null
}

function buildPrompt(input: AnalyzeTopicPlanInput, fidelityPolicy: SourceFidelityPolicy | null) {
  const focusList = input.pageFocuses
    .map((focus, i) => `Draft focus ${i + 1}: ${compact(focus, 240)}`)
    .join('\n')
  const isSourceCourse = Boolean(fidelityPolicy)
  const sourceCoverageRule = fidelityPolicy
    ? `\n\n${buildPlanFidelityDirective(fidelityPolicy)}`
    : ''

  return {
    system: `You are TruLurn's Topic Lesson Planner.
Plan the teaching design for an ENTIRE topic in one pass, using backward design,
cognitive-load control, intuition-before-formalism, early examples, active retrieval,
misconception prevention, and page-to-page continuity ACROSS the whole topic.
You see every page at once — use that to sequence roles and prevent any concept
from being taught twice.

Treat the topic as ONE continuous textbook manuscript. Plan page breaks upfront by
estimated written length. A page is a physical span of that manuscript, not an
independent mini-lesson and not necessarily one concept.
Return only valid JSON. Do not write lesson prose.`,
    user: `Course: ${input.course.title ?? input.course.topic}
Course goal: ${input.course.goals ?? 'Master the subject clearly enough to explain and apply it.'}
Course depth: ${input.course.course_depth ?? 'standard'}

Topic: ${input.topic.title}
Topic description: ${input.topic.description ?? input.topic.summary ?? 'No stored description.'}
Topic depth label: ${input.topic.depth ?? 'medium'}
Maximum pages available: ${input.plannedPages}

Draft page focuses from the curriculum (a rough guess made before any content existed — merge, drop, or rewrite them freely):
${focusList || 'No page focuses supplied — infer a sensible page breakdown.'}

Course map pointer:
${input.mapPointer || 'No map pointer supplied.'}

Retrieved course memory:
${formatMemory(input.memory, isSourceCourse)}${sourceCoverageRule}

${input.courseSkillContext || 'No course skill context is attached.'}

PAGE-BREAK POLICY — plan breaks by length:
- First estimate the words needed to teach the topic properly, without padding.
- Use roughly 480-680 words as the normal physical page capacity. Prefer readable,
  well-developed explanation over packing several substantial ideas into one dense page.
- Treat the curriculum's draft page count as a useful baseline, not a quota to minimize.
  Use fewer pages only when the material is genuinely thin or duplicate.
- Give distinct substantial mechanisms, formal definitions, worked examples, and
  high-risk misconceptions enough room to be taught rather than merely mentioned.
- Prefer to begin a substantial new concept on the next page when the current page is
  already near capacity. This is a preference, not a hard rule.
- If a concept finishes with meaningful room left, begin the next concept on the same
  page. Do not leave artificial blank space merely to preserve one-concept-per-page.
- If the current concept is almost complete at the target, finish it on the same page
  using the soft overflow allowance. Do not create a new page for a few remaining lines.
- Split a concept across pages only when finishing it would exceed soft_max_words. Mark
  both sides with continuation flags and choose a genuine reasoning pause as the break.
- Assign every substantive point exactly once. Adjacent spans may share a concept only
  when that concept genuinely continues across the break.
- Never plan pages whose only purpose is recap, motivation, transition, or "what's next".
- Never exceed the supplied maximum. Every planned page will be generated and read.
- Use content_kind "full_page" for normal physical pages. Page roles describe movement
  through the manuscript; they do not turn pages into isolated lessons.

Return this exact JSON shape:
{
  "estimated_total_words": 2100,
  "page_word_target": 560,
  "page_count_reason": "one line: why this manuscript needs exactly N physical pages",
  "pages": [
    {
      "page_number": 1,
      "focus": "the consecutive content span covered on this page",
      "content_kind": "full_page",
      "page_sequence_role": "introduce|deepen|connect|repair|practice|review",
      "target_length": "short|medium|long",
      "target_words": 560,
      "soft_max_words": 680,
      "concepts": ["concepts or subsections covered, in order"],
      "start_boundary": "where this page begins in the continuous explanation",
      "end_boundary": "the exact understanding or reasoning point reached before the break",
      "continues_from_previous": false,
      "continues_to_next": true,
      "break_preference": "concept_boundary|natural_pause|soft_overflow",
      "break_reason": "why this is the least disruptive length-based break",
      "brief": {
        "concept_importance": "critical|important|supporting|peripheral",
        "concept_difficulty": "low|medium|high",
        "reasoning_need": "low|medium|high",
        "teaching_depth": 1,
        "requires_formal_definition": true,
        "misconception_risk": "low|medium|high",
        "target_understanding": "what the reader understands by the end of this consecutive span",
        "success_criteria": ["what the learner should be able to explain or do"],
        "why_this_matters_now": "why this page matters at this point",
        "required_prior_knowledge": ["prior idea needed now"],
        "prior_knowledge_repair": ["brief repair if a prior idea is fragile"],
        "likely_misconceptions": ["specific wrong belief to prevent"],
        "intuition_plan": "the mental model to build before formalism",
        "representation_plan": ["prose", "bullets", "data chart", "coordinate vector diagram", "math", "code", "table"],
        "example_strategy": {
          "opening_example": "concrete opener or null",
          "worked_example_needed": true,
          "contrast_case_needed": false,
          "reusable_example_refs": ["earlier example to reuse"]
        },
        "active_processing": {
          "retrieval_prompt": "short recall question or null",
          "self_explanation_prompt": "explain-in-your-own-words prompt or null",
          "transfer_prompt": "apply/transfer prompt or null"
        },
        "page_sequence_role": "deepen",
        "cross_page_connection": "how this page links to prior and next pages of THIS topic",
        "cognitive_load_notes": ["how to segment or avoid overload"],
        "retention_hooks": {
          "revisit_concepts": ["concept to revisit later"],
          "retrieval_prompt": "future retrieval question or null",
          "contrast_prompt": "near-miss/contrast question or null",
          "transfer_prompt": "future transfer question or null"
        },
        "recommended_content_kind": "full_page",
        "confidence": "low|medium|high",
        "reason": "why this architecture is appropriate"
      }
    }
  ]
}

Rules:
- "pages" must contain between 1 and ${input.plannedPages} entries, numbered contiguously from 1.
- For every brief, recommend concept_importance, concept_difficulty, reasoning_need,
  teaching_depth, requires_formal_definition, and misconception_risk by judging
  this span's role in the whole course: prerequisite value, future reuse, source
  emphasis, assessment/interview usefulness, abstraction, failure modes, and how
  much bridging it needs to connect prior and later concepts.
- These are planner recommendations for the lesson writer, not hard commands.
  The writer must verify them against the current source evidence, page boundary,
  prior pages, and token budget.
- reasoning_need recommends initial model deliberation, not answer length: use high for
  critical abstractions, math/procedures, optimization/training mechanics,
  source-dense spans, high-risk misconceptions, or pages whose explanation must
  bridge multiple concepts; use medium for normal conceptual pages; use low for
  recognition, history, notation, simple orientation, or peripheral support.
- teaching_depth is a recommended 1-5 scale: 1 quick recognition, 3 solid course-page teaching, 5
  careful treatment with formal definition, mechanism, example, boundaries, and
  future bridges.
- target_words is an upper planning budget, not a mandatory minimum.
- soft_max_words is the allowed finish-the-thought overflow and must be at least target_words.
- Use short for about 240-420 words, medium for about 480-680, and long only when
  a coherent span genuinely needs about 700-900 words.
- The first page must set continues_from_previous=false. The final page must set
  continues_to_next=false. Other flags must match the actual adjacent content.
- A page may cover multiple concepts. A concept may cross a page break only when its
  continuation flags make that explicit.
- A full_page brief MUST include at least one active_processing prompt when it covers a
  dense mechanism, math, procedure, or high-risk misconception.
- ${VISUAL_REPRESENTATION_PLANNING_RULES.replace(/\n/g, '\n- ')}
- Treat COURSE SKILL CONTEXT as trusted subject guidance. Apply only relevant instructions and never let it expand the course boundary.
- Do not restart or summarize merely because a page boundary exists.
- Keep every field compact and implementation-ready.`,
  }
}

export async function analyzeTopicPlan(input: AnalyzeTopicPlanInput): Promise<TopicLessonPlan> {
  const fidelityPolicy = policyFromCourse(input.course)
  const prompt = buildPrompt(input, fidelityPolicy)
  const text = await generateAI({
    feature: 'topic_plan_analysis',
    ...prompt,
    purpose: 'primary',
    responseMimeType: 'application/json',
  })
  const raw = parseAIJson<any>(text)
  const rawPages: any[] = Array.isArray(raw?.pages) ? raw.pages : []

  // Keep only real, generatable pages (no skip placeholders), capped at the
  // available maximum, and renumber
  // contiguously so navigation never has gaps.
  const ceiling = Math.max(1, Number(input.plannedPages) || 1)
  const pages: TopicPagePlan[] = []
  for (const match of rawPages) {
    if (pages.length >= ceiling) break
    const proposedContentKind = normalizeContentKind(match?.content_kind)
    if (proposedContentKind === 'skip') continue
    const contentKind: ContentKind = 'full_page'
    const pageNumber = pages.length + 1
    const role = normalizeRole(match?.page_sequence_role)
    const focus = compact(match?.focus, 240)
      || input.pageFocuses[pageNumber - 1]
      || `Page ${pageNumber} of ${input.topic.title}`
    const targetLength = normalizeTargetLength(match?.target_length, contentKind)
    const defaults = WORD_BUDGETS[targetLength]
    const targetWords = boundedInteger(match?.target_words, defaults.target, 220, 860)
    const softMaxWords = boundedInteger(
      match?.soft_max_words,
      Math.max(defaults.softMax, targetWords + 80),
      targetWords,
      980,
    )

    // Only full_page pages carry a full architecture brief.
    let brief: LearningArchitectureBrief | null = null
    if (contentKind === 'full_page' && match?.brief) {
      const normalized = {
        ...normalizeBrief(match.brief),
        recommended_content_kind: contentKind,
        page_sequence_role: role,
      }
      // Keep the brief only if it passes the same quality gate as the per-page analyzer;
      // otherwise leave it null and let the route fall back to a per-page brief lazily.
      if (validateLearningArchitectureBrief(normalized).length === 0) {
        brief = normalized
      }
    }

    pages.push({
      page_number: pageNumber,
      focus,
      content_kind: contentKind,
      page_sequence_role: role,
      target_length: targetLength,
      target_words: targetWords,
      soft_max_words: softMaxWords,
      concepts: normalizeConcepts(match?.concepts, focus),
      start_boundary: compact(match?.start_boundary, 300) || focus,
      end_boundary: compact(match?.end_boundary, 300) || focus,
      continues_from_previous: pageNumber > 1 && Boolean(match?.continues_from_previous),
      continues_to_next: Boolean(match?.continues_to_next),
      break_preference: normalizeBreakPreference(match?.break_preference),
      break_reason: compact(match?.break_reason, 260) || 'A natural pause near the planned word budget.',
      brief,
    })
  }

  for (let index = 0; index < pages.length; index += 1) {
    pages[index].continues_from_previous = index > 0 && pages[index - 1].continues_to_next
    if (index === pages.length - 1) pages[index].continues_to_next = false
  }

  // Defensive floor: a topic always has at least one page.
  if (!pages.length) {
    pages.push({
      page_number: 1,
      focus: input.pageFocuses[0] || `Introduce ${input.topic.title}, its role in the course, and the core intuition.`,
      content_kind: 'full_page',
      page_sequence_role: 'introduce',
      target_length: 'medium',
      target_words: WORD_BUDGETS.medium.target,
      soft_max_words: WORD_BUDGETS.medium.softMax,
      concepts: [input.topic.title],
      start_boundary: `Begin ${input.topic.title}.`,
      end_boundary: `Complete the core explanation of ${input.topic.title}.`,
      continues_from_previous: false,
      continues_to_next: false,
      break_preference: 'concept_boundary',
      break_reason: 'The topic fits on one physical page.',
      brief: null,
    })
  }

  return {
    generated_at: new Date().toISOString(),
    version: PLAN_VERSION,
    estimated_total_words: boundedInteger(
      raw?.estimated_total_words,
      pages.reduce((sum, page) => sum + page.target_words, 0),
      200,
      12_000,
    ),
    page_word_target: boundedInteger(raw?.page_word_target, 560, 240, 900),
    fidelity_key: fidelityPolicy?.key ?? null,
    skill_context_key: input.courseSkillContextKey ?? null,
    page_count_reason: compact(raw?.page_count_reason, 240) || `Planned ${pages.length} page(s) from conceptual load.`,
    pages,
  }
}
