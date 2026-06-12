import { generateAI, parseAIJson } from '@/lib/ai'
import { buildPlanFidelityDirective, policyFromCourse, type SourceFidelityPolicy } from '@/lib/course-generation/sourceFidelity'
import type { CourseMemoryContext } from '@/lib/vector/retrieval'
import type { ContentKind } from '@/types'
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
// conceptual load and consolidates freely: a thin topic becomes ONE substantive
// page, never three padded ones. Pages the topic doesn't need are simply not
// planned (no "skip" placeholders), so they are never generated and never
// cost a model call.

export type PageTargetLength = 'short' | 'medium' | 'long'

export type TopicPagePlan = {
  page_number: number
  focus: string
  content_kind: ContentKind
  page_sequence_role: PageSequenceRole
  target_length: PageTargetLength
  brief: LearningArchitectureBrief | null
}

export type TopicLessonPlan = {
  generated_at: string
  version: number
  /** Source fidelity policy key the plan was built under (null for ai_teacher). */
  fidelity_key?: string | null
  /** Planner's one-line justification for the page count. */
  page_count_reason: string
  pages: TopicPagePlan[]
}

// v2: consolidation — the planner chooses the page count (≤ ceiling) and plans
// no skip entries. v1 plans were padded to estimated_pages; treat them as stale.
export const PLAN_VERSION = 2

/**
 * A plan is usable when it matches the current planner contract — and, when an
 * expected fidelity key is supplied, when it was built under the SAME source
 * fidelity policy. This is what makes the system adaptive: a mid-course style
 * or coverage change produces a new key, so topics re-plan on next touch.
 */
export function isPlanCurrent(
  plan: TopicLessonPlan | undefined | null,
  expectedFidelityKey?: string | null,
): plan is TopicLessonPlan {
  if (
    !plan
    || Number(plan.version) < PLAN_VERSION
    || !Array.isArray(plan.pages)
    || plan.pages.length < 1
  ) return false
  if (expectedFidelityKey !== undefined && (plan.fidelity_key ?? null) !== expectedFidelityKey) return false
  return true
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

You also decide HOW MANY pages this topic genuinely deserves. Every page costs the
student attention and the system a generation — a page must earn its existence with
distinct, substantive teaching value. One dense, well-built page beats three thin ones.
Return only valid JSON. Do not write lesson prose.`,
    user: `Course: ${input.course.title ?? input.course.topic}
Course goal: ${input.course.goals ?? 'Master the subject clearly enough to explain and apply it.'}
Course depth: ${input.course.course_depth ?? 'standard'}

Topic: ${input.topic.title}
Topic description: ${input.topic.description ?? input.topic.summary ?? 'No stored description.'}
Topic depth label: ${input.topic.depth ?? 'medium'}
Page budget (CEILING, not a target): ${input.plannedPages}

Draft page focuses from the curriculum (a rough guess made before any content existed — merge, drop, or rewrite them freely):
${focusList || 'No page focuses supplied — infer a sensible page breakdown.'}

Course map pointer:
${input.mapPointer || 'No map pointer supplied.'}

Retrieved course memory:
${formatMemory(input.memory, isSourceCourse)}${sourceCoverageRule}

PAGE COUNT — decide it from conceptual load, not from the budget:
- Count the genuinely distinct concepts, mechanisms, or skills this topic must teach.
- A topic with one core idea gets ONE page, even if the budget allows more. Definitional,
  orientation, or recap topics are almost always one page.
- Plan a second page only when the first page genuinely cannot hold the next concept
  without overloading the learner — not to "spread material out".
- Merge draft focuses that overlap or are too thin to stand alone.
- Never exceed the page budget. Never plan a page whose only job is recap, motivation,
  or "what's next" — fold those lines into a real page.
- Do NOT plan placeholder or skip pages. Every planned page WILL be generated and read.

Plan each page. Decide the SMALLEST content kind that teaches its focus, and assign a
sequence role so the topic reads as one coherent arc (e.g. introduce → deepen →
connect → practice → review). Only pages whose content_kind is "full_page" get a full
architecture brief; bridge/section/example pages set "brief" to null.

Return this exact JSON shape:
{
  "page_count_reason": "one line: why this topic needs exactly N pages",
  "pages": [
    {
      "page_number": 1,
      "focus": "the focus for this page",
      "content_kind": "full_page|section|bridge|example",
      "page_sequence_role": "introduce|deepen|connect|repair|practice|review",
      "target_length": "short|medium|long",
      "brief": null
    },
    {
      "page_number": 2,
      "focus": "...",
      "content_kind": "full_page",
      "page_sequence_role": "deepen",
      "target_length": "medium",
      "brief": {
        "target_understanding": "what mental change this page should create",
        "success_criteria": ["what the learner should be able to explain or do"],
        "why_this_matters_now": "why this page matters at this point",
        "required_prior_knowledge": ["prior idea needed now"],
        "prior_knowledge_repair": ["brief repair if a prior idea is fragile"],
        "likely_misconceptions": ["specific wrong belief to prevent"],
        "intuition_plan": "the mental model to build before formalism",
        "representation_plan": ["prose", "bullets", "math", "code", "table"],
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
- target_length is a CEILING for the writer: short ≈ 250-450 words, medium ≈ 550-850, long ≈ 900-1200.
  Choose the smallest length that genuinely teaches the focus.
- A full_page brief MUST include at least one active_processing prompt when it covers a
  dense mechanism, math, procedure, or high-risk misconception.
- Do not re-teach the same concept on two pages — assign distinct concepts per page and
  use later pages to deepen/connect/practice rather than repeat.
- For non-full_page pages, set "brief": null.
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

  // Honor the planner's consolidation: keep only real, generatable pages
  // (no skip placeholders), capped at the curriculum's ceiling, and renumber
  // contiguously so navigation never has gaps.
  const ceiling = Math.max(1, Number(input.plannedPages) || 1)
  const pages: TopicPagePlan[] = []
  for (const match of rawPages) {
    if (pages.length >= ceiling) break
    const contentKind = normalizeContentKind(match?.content_kind)
    if (contentKind === 'skip') continue
    const pageNumber = pages.length + 1
    const role = normalizeRole(match?.page_sequence_role)
    const focus = compact(match?.focus, 240)
      || input.pageFocuses[pageNumber - 1]
      || `Page ${pageNumber} of ${input.topic.title}`

    // Only full_page pages carry a full architecture brief.
    let brief: LearningArchitectureBrief | null = null
    if (contentKind === 'full_page' && match?.brief) {
      const normalized = normalizeBrief(match.brief)
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
      target_length: normalizeTargetLength(match?.target_length, contentKind),
      brief,
    })
  }

  // Defensive floor: a topic always has at least one page.
  if (!pages.length) {
    pages.push({
      page_number: 1,
      focus: input.pageFocuses[0] || `Introduce ${input.topic.title}, its role in the course, and the core intuition.`,
      content_kind: 'full_page',
      page_sequence_role: 'introduce',
      target_length: 'medium',
      brief: null,
    })
  }

  return {
    generated_at: new Date().toISOString(),
    version: PLAN_VERSION,
    fidelity_key: fidelityPolicy?.key ?? null,
    page_count_reason: compact(raw?.page_count_reason, 240) || `Planned ${pages.length} page(s) from conceptual load.`,
    pages,
  }
}
