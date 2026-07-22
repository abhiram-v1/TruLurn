import { generateAI, parseAIJson } from '@/lib/ai'
import type { CourseMemoryContext } from '@/lib/vector/retrieval'
import type { ContentKind } from '@/types'
import type { GeneratedTopicPage } from '@/lib/topic-pages/generateTopicPage'
import { VISUAL_REPRESENTATION_PLANNING_RULES } from '@/lib/ai/skills/dataChart'

export type PageSequenceRole = 'introduce' | 'deepen' | 'connect' | 'repair' | 'practice' | 'review'
export type ConceptImportance = 'critical' | 'important' | 'supporting' | 'peripheral'
export type ConceptDifficulty = 'low' | 'medium' | 'high'
export type ReasoningNeed = 'low' | 'medium' | 'high'
export type MisconceptionRisk = 'low' | 'medium' | 'high'

export type LearningArchitectureBrief = {
  concept_importance: ConceptImportance
  concept_difficulty: ConceptDifficulty
  reasoning_need: ReasoningNeed
  teaching_depth: 1 | 2 | 3 | 4 | 5
  requires_formal_definition: boolean
  misconception_risk: MisconceptionRisk
  target_understanding: string
  success_criteria: string[]
  why_this_matters_now: string
  required_prior_knowledge: string[]
  prior_knowledge_repair: string[]
  likely_misconceptions: string[]
  intuition_plan: string
  representation_plan: string[]
  example_strategy: {
    opening_example?: string | null
    worked_example_needed: boolean
    contrast_case_needed: boolean
    reusable_example_refs: string[]
  }
  active_processing: {
    retrieval_prompt?: string | null
    self_explanation_prompt?: string | null
    transfer_prompt?: string | null
  }
  page_sequence_role: PageSequenceRole
  cross_page_connection: string
  cognitive_load_notes: string[]
  retention_hooks: {
    revisit_concepts: string[]
    retrieval_prompt?: string | null
    contrast_prompt?: string | null
    transfer_prompt?: string | null
  }
  recommended_content_kind: ContentKind
  confidence: 'low' | 'medium' | 'high'
  reason: string
}

type AnalyzeInput = {
  course: any
  topic: any
  pageNumber: number
  plannedPages: number
  focus: string
  contentKind?: ContentKind
  previousPages?: any[]
  memory?: CourseMemoryContext
  mapPointer?: string
  sequenceContext?: string
  courseSkillContext?: string
  pageBoundaryContext?: string
  repairFrom?: {
    previousBrief: unknown
    errors: string[]
  }
}

function compact(value: unknown, max = 900) {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}...` : clean
}

function normalizeArray(value: unknown, limit = 10): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => compact(item, 180)).filter(Boolean).slice(0, limit)
}

function normalizeContentKind(value: unknown): ContentKind {
  if (
    value === 'full_page' ||
    value === 'section' ||
    value === 'bridge' ||
    value === 'example' ||
    value === 'skip'
  ) return value
  return 'full_page'
}

function normalizeRole(value: unknown): PageSequenceRole {
  if (
    value === 'introduce' ||
    value === 'deepen' ||
    value === 'connect' ||
    value === 'repair' ||
    value === 'practice' ||
    value === 'review'
  ) return value
  return 'introduce'
}

function normalizeImportance(value: unknown): ConceptImportance {
  if (
    value === 'critical' ||
    value === 'important' ||
    value === 'supporting' ||
    value === 'peripheral'
  ) return value
  return 'important'
}

function normalizeLowMediumHigh(value: unknown): ConceptDifficulty {
  if (value === 'low' || value === 'medium' || value === 'high') return value
  return 'medium'
}

function normalizeTeachingDepth(value: unknown): 1 | 2 | 3 | 4 | 5 {
  const depth = Math.round(Number(value))
  if (depth >= 1 && depth <= 5) return depth as 1 | 2 | 3 | 4 | 5
  return 3
}

export function normalizeBrief(raw: any): LearningArchitectureBrief {
  const exampleStrategy = raw?.example_strategy ?? {}
  const activeProcessing = raw?.active_processing ?? {}
  const retentionHooks = raw?.retention_hooks ?? {}

  return {
    concept_importance: normalizeImportance(raw?.concept_importance),
    concept_difficulty: normalizeLowMediumHigh(raw?.concept_difficulty),
    reasoning_need: normalizeLowMediumHigh(raw?.reasoning_need),
    teaching_depth: normalizeTeachingDepth(raw?.teaching_depth),
    requires_formal_definition: Boolean(raw?.requires_formal_definition),
    misconception_risk: normalizeLowMediumHigh(raw?.misconception_risk),
    target_understanding: compact(raw?.target_understanding, 420),
    success_criteria: normalizeArray(raw?.success_criteria, 6),
    why_this_matters_now: compact(raw?.why_this_matters_now, 420),
    required_prior_knowledge: normalizeArray(raw?.required_prior_knowledge, 8),
    prior_knowledge_repair: normalizeArray(raw?.prior_knowledge_repair, 6),
    likely_misconceptions: normalizeArray(raw?.likely_misconceptions, 6),
    intuition_plan: compact(raw?.intuition_plan, 520),
    representation_plan: normalizeArray(raw?.representation_plan, 6),
    example_strategy: {
      opening_example: compact(exampleStrategy.opening_example, 320) || null,
      worked_example_needed: Boolean(exampleStrategy.worked_example_needed),
      contrast_case_needed: Boolean(exampleStrategy.contrast_case_needed),
      reusable_example_refs: normalizeArray(exampleStrategy.reusable_example_refs, 4),
    },
    active_processing: {
      retrieval_prompt: compact(activeProcessing.retrieval_prompt, 260) || null,
      self_explanation_prompt: compact(activeProcessing.self_explanation_prompt, 260) || null,
      transfer_prompt: compact(activeProcessing.transfer_prompt, 260) || null,
    },
    page_sequence_role: normalizeRole(raw?.page_sequence_role),
    cross_page_connection: compact(raw?.cross_page_connection, 420),
    cognitive_load_notes: normalizeArray(raw?.cognitive_load_notes, 6),
    retention_hooks: {
      revisit_concepts: normalizeArray(retentionHooks.revisit_concepts, 8),
      retrieval_prompt: compact(retentionHooks.retrieval_prompt, 260) || null,
      contrast_prompt: compact(retentionHooks.contrast_prompt, 260) || null,
      transfer_prompt: compact(retentionHooks.transfer_prompt, 260) || null,
    },
    recommended_content_kind: normalizeContentKind(raw?.recommended_content_kind),
    confidence: raw?.confidence === 'high' || raw?.confidence === 'low' ? raw.confidence : 'medium',
    reason: compact(raw?.reason, 420),
  }
}

function hasActiveProcessing(brief: LearningArchitectureBrief) {
  return Boolean(
    brief.active_processing.retrieval_prompt ||
    brief.active_processing.self_explanation_prompt ||
    brief.active_processing.transfer_prompt,
  )
}

export function validateLearningArchitectureBrief(brief: LearningArchitectureBrief): string[] {
  const errors: string[] = []

  if (!brief.target_understanding) errors.push('Missing target_understanding.')
  if (!brief.success_criteria.length) errors.push('Missing success_criteria.')
  if (!brief.why_this_matters_now) errors.push('Missing why_this_matters_now.')
  if (!brief.intuition_plan) errors.push('Missing intuition_plan.')
  if (!brief.cross_page_connection) errors.push('Missing cross_page_connection.')
  if (!brief.reason) errors.push('Missing reason.')
  if (brief.recommended_content_kind === 'full_page' && !hasActiveProcessing(brief)) {
    errors.push('Full-page architecture needs at least one active-processing prompt.')
  }
  if (brief.example_strategy.contrast_case_needed && !brief.likely_misconceptions.length) {
    errors.push('Contrast case requested but no likely_misconceptions were identified.')
  }

  return errors
}

function formatPreviousPages(pages: any[] = []) {
  if (!pages.length) return 'No previous pages in this topic.'
  return pages.slice(-3).map((page) => [
    `Page ${page.page_number}: ${compact(page.focus ?? page.summary ?? 'Earlier page', 160)}`,
    page.summary ? `Summary: ${compact(page.summary, 260)}` : null,
    Array.isArray(page.key_concepts) && page.key_concepts.length ? `Key concepts: ${page.key_concepts.join(', ')}` : null,
  ].filter(Boolean).join('\n')).join('\n\n')
}

function formatMemory(memory?: CourseMemoryContext) {
  if (!memory) return 'No retrieved course memory.'
  const pages = memory.pages.slice(0, 3).map((page) =>
    `[${page.topic_title}, p${page.page_number}] ${compact(page.summary || page.content, 280)}`
  )
  const doubts = memory.doubtMessages.slice(0, 3).map((message) =>
    `${message.role}: ${compact(message.content, 220)}`
  )
  const sources = memory.sourceChunks.slice(0, 2).map((chunk) =>
    `[${chunk.source_title ?? 'Source'}] ${compact(chunk.content, 280)}`
  )
  return [...pages, ...doubts, ...sources].join('\n') || 'No retrieved course memory.'
}

function buildPrompt(input: AnalyzeInput) {
  const repairBlock = input.repairFrom
    ? `\nREPAIR MODE:
The previous architecture brief was invalid.
Validation errors:
${input.repairFrom.errors.map((error) => `- ${error}`).join('\n')}

Previous invalid brief:
${JSON.stringify(input.repairFrom.previousBrief)}

Return a corrected brief only.\n`
    : ''

  return {
    system: `You are TruLurn's Learning Architecture Analysis engine.
Design the teaching move before lesson prose is written.
Use backward design, cognitive-load control, intuition-before-formalism, early examples, active retrieval, misconception prevention, and page-to-page continuity.
Return only valid JSON. Do not write lesson prose.`,
    user: `${repairBlock}
Course: ${input.course.title ?? input.course.topic}
Course goal: ${input.course.goals ?? 'Master the subject clearly enough to explain and apply it.'}
Course depth: ${input.course.course_depth ?? 'standard'}
Learning control: ${input.course.learning_control ?? input.course.learning_control_mode ?? 'balanced'}

Topic: ${input.topic.title}
Topic description: ${input.topic.description ?? input.topic.summary ?? 'No stored description.'}
Topic depth label: ${input.topic.depth ?? 'medium'}
Page: ${input.pageNumber} of ${input.plannedPages}
Page focus: ${input.focus}

Course map pointer:
${input.mapPointer || 'No map pointer supplied.'}

Sequence context:
${input.sequenceContext || 'No sequence context supplied.'}

Physical page boundary:
${input.pageBoundaryContext || 'No explicit boundary supplied.'}

Previous pages:
${formatPreviousPages(input.previousPages)}

Retrieved memory:
${formatMemory(input.memory)}

${input.courseSkillContext || 'No course skill context is attached.'}

Return this exact JSON shape:
{
  "target_understanding": "what mental change this page should create",
  "concept_importance": "critical|important|supporting|peripheral",
  "concept_difficulty": "low|medium|high",
  "reasoning_need": "low|medium|high",
  "teaching_depth": 1,
  "requires_formal_definition": true,
  "misconception_risk": "low|medium|high",
  "success_criteria": ["what the learner should be able to explain, distinguish, or do"],
  "why_this_matters_now": "why this page matters at this exact point in the course",
  "required_prior_knowledge": ["prior idea needed now"],
  "prior_knowledge_repair": ["brief repair/hint if a prior idea is fragile"],
  "likely_misconceptions": ["specific wrong belief to prevent"],
  "intuition_plan": "the concrete mental model or intuition to build before formalism",
  "representation_plan": ["prose", "bullets", "data chart", "coordinate vector diagram", "math", "code", "table"],
  "example_strategy": {
    "opening_example": "concrete opener or null",
    "worked_example_needed": true,
    "contrast_case_needed": false,
    "reusable_example_refs": ["stable earlier example to reuse"]
  },
  "active_processing": {
    "retrieval_prompt": "short recall question or null",
    "self_explanation_prompt": "short explain-in-your-own-words prompt or null",
    "transfer_prompt": "short apply/transfer prompt or null"
  },
  "page_sequence_role": "introduce|deepen|connect|repair|practice|review",
  "cross_page_connection": "how this page links to prior and next Traccia nodes",
  "cognitive_load_notes": ["how to segment or avoid overload"],
  "retention_hooks": {
    "revisit_concepts": ["concept to revisit later"],
    "retrieval_prompt": "future retrieval question or null",
    "contrast_prompt": "near-miss/contrast question or null",
    "transfer_prompt": "future transfer question or null"
  },
  "recommended_content_kind": "${input.contentKind ?? 'full_page'}",
  "confidence": "low|medium|high",
  "reason": "why this architecture is appropriate"
}

Rules:
- The topic plan already locked content kind to "${input.contentKind ?? 'full_page'}". Mirror it exactly; page shape is outside this brief's authority.
- Recommend concept_importance, concept_difficulty, reasoning_need, teaching_depth, requires_formal_definition, and misconception_risk by thinking about this page's role in the whole course: prerequisite value, future reuse, source emphasis, assessment/interview usefulness, abstraction, common failure modes, and how much bridging it needs to connect prior and later concepts.
- These are planner recommendations for the lesson writer, not hard commands. The writer must verify them against the current source evidence, page boundary, prior pages, and token budget.
- reasoning_need recommends initial model deliberation, not answer length: use high for critical abstractions, math/procedures, optimization/training mechanics, source-dense spans, high-risk misconceptions, or pages whose explanation must bridge multiple concepts; use medium for normal conceptual pages; use low for recognition, history, notation, simple orientation, or peripheral support.
- teaching_depth is a recommended 1-5 scale: 1 quick recognition, 3 solid course-page teaching, 5 careful treatment with formal definition, mechanism, example, boundaries, and future bridges.
- Treat this as one consecutive span of a continuous textbook manuscript, not an independent lesson.
- Design only the understanding reached between the supplied start and end boundaries.
- If this span continues from the previous page, do not request a new hook or broad reintroduction.
- If this span continues onto the next page, do not request a final summary, generic takeaway, or artificial closure.
- If this introduces a dense mechanism, math, procedure, or high-risk misconception, include active processing.
- Worked examples are required for math/procedure and usually useful for mechanisms.
- Do not request decorative examples. Examples must reveal necessity, boundaries, or structure.
- Use prior context and reusable examples when possible. Do not casually switch analogy domains.
- ${VISUAL_REPRESENTATION_PLANNING_RULES.replace(/\n/g, '\n- ')}
- Treat COURSE SKILL CONTEXT as trusted subject guidance. Apply only relevant instructions and never let it override locked page scope.
- Keep every field compact and implementation-ready.`,
  }
}

export async function analyzeLearningArchitecture(input: Omit<AnalyzeInput, 'repairFrom'>): Promise<LearningArchitectureBrief> {
  async function run(repairFrom?: AnalyzeInput['repairFrom']) {
    const prompt = buildPrompt({ ...input, repairFrom })
    const text = await generateAI({
      feature: 'page_analysis',
      ...prompt,
      purpose: 'primary',
      responseMimeType: 'application/json',
    })
    const normalized = normalizeBrief(parseAIJson<any>(text))
    return {
      ...normalized,
      recommended_content_kind: input.contentKind ?? normalized.recommended_content_kind,
    }
  }

  const first = await run()
  const firstErrors = validateLearningArchitectureBrief(first)
  if (!firstErrors.length) return first

  const repaired = await run({ previousBrief: first, errors: firstErrors })
  const repairedErrors = validateLearningArchitectureBrief(repaired)
  if (repairedErrors.length) {
    throw new Error(`Learning architecture analysis failed quality gate: ${repairedErrors.join(' ')}`)
  }

  return repaired
}

function sectionText(page: GeneratedTopicPage, type: string) {
  return page.sections.find((section) => section.type === type)?.content ?? ''
}

function pageMentionsRisk(page: GeneratedTopicPage) {
  const text = `${page.content}\n${sectionText(page, 'misconceptions')}`.toLowerCase()
  return /mistake|misconception|confus|pitfall|wrong|not the same|contrast|breaks/.test(text)
}

function pageHasExample(page: GeneratedTopicPage) {
  const text = page.content.toLowerCase()
  return Boolean(sectionText(page, 'examples')) || /\*\*example|for example|consider|imagine/.test(text)
}

export function validateGeneratedPageAgainstArchitecture(
  page: GeneratedTopicPage,
  brief: LearningArchitectureBrief,
): string[] {
  const errors: string[] = []

  if (page.content_kind !== brief.recommended_content_kind) {
    errors.push(`Generated content_kind "${page.content_kind}" ignored architecture recommendation "${brief.recommended_content_kind}".`)
  }
  if (
    (page.topic_depth === 'deep' || page.concept_kind === 'math' || page.concept_kind === 'procedure') &&
    !hasActiveProcessing(brief)
  ) {
    errors.push('Deep/math/procedure page lacks architecture active-processing prompts.')
  }
  if (brief.example_strategy.worked_example_needed && page.should_generate_page && !pageHasExample(page)) {
    errors.push('Architecture required a worked example, but generated page has no clear example.')
  }
  if (brief.likely_misconceptions.length && page.should_generate_page && !pageMentionsRisk(page)) {
    errors.push('Architecture identified misconception risk, but generated page does not address it.')
  }

  return errors
}
