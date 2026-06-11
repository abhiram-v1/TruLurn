import { generateWithGemini } from '@/lib/ai/gemini/client'
import { parseGeminiJson } from '@/lib/ai/gemini/json'
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
// sees the whole arc at once and can sequence + dedup globally. Simple pages
// (bridge/section/example) carry no full brief — only full_page pages do.

export type TopicPagePlan = {
  page_number: number
  focus: string
  content_kind: ContentKind
  page_sequence_role: PageSequenceRole
  brief: LearningArchitectureBrief | null
}

export type TopicLessonPlan = {
  generated_at: string
  version: number
  pages: TopicPagePlan[]
}

const PLAN_VERSION = 1

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

function formatMemory(memory?: CourseMemoryContext) {
  if (!memory) return 'No retrieved course memory.'
  const pages = memory.pages.slice(0, 3).map((p) => `[${p.topic_title}, p${p.page_number}] ${compact(p.summary || p.content, 240)}`)
  const sources = memory.sourceChunks.slice(0, 2).map((c) => `[${c.source_title ?? 'Source'}] ${compact(c.content, 240)}`)
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

function buildPrompt(input: AnalyzeTopicPlanInput) {
  const focusList = input.pageFocuses
    .map((focus, i) => `Page ${i + 1}: ${compact(focus, 240)}`)
    .join('\n')

  return {
    system: `You are TruLurn's Topic Lesson Planner.
Plan the teaching design for an ENTIRE topic in one pass, using backward design,
cognitive-load control, intuition-before-formalism, early examples, active retrieval,
misconception prevention, and page-to-page continuity ACROSS the whole topic.
You see every page at once — use that to sequence roles and prevent any concept
from being taught twice. Return only valid JSON. Do not write lesson prose.`,
    user: `Course: ${input.course.title ?? input.course.topic}
Course goal: ${input.course.goals ?? 'Master the subject clearly enough to explain and apply it.'}
Course depth: ${input.course.course_depth ?? 'standard'}

Topic: ${input.topic.title}
Topic description: ${input.topic.description ?? input.topic.summary ?? 'No stored description.'}
Topic depth label: ${input.topic.depth ?? 'medium'}
Total pages in this topic: ${input.plannedPages}

Planned page focuses:
${focusList || 'No page focuses supplied — infer a sensible page breakdown.'}

Course map pointer:
${input.mapPointer || 'No map pointer supplied.'}

Retrieved course memory:
${formatMemory(input.memory)}

Plan each page. Decide the SMALLEST content kind that teaches its focus, and assign a
sequence role so the topic reads as one coherent arc (e.g. introduce → deepen →
connect → practice → review). Only pages whose content_kind is "full_page" get a full
architecture brief; bridge/section/example/skip pages set "brief" to null.

Return this exact JSON shape:
{
  "pages": [
    {
      "page_number": 1,
      "focus": "the focus for this page",
      "content_kind": "full_page|section|bridge|example|skip",
      "page_sequence_role": "introduce|deepen|connect|repair|practice|review",
      "brief": null
    },
    {
      "page_number": 2,
      "focus": "...",
      "content_kind": "full_page",
      "page_sequence_role": "deepen",
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
- Produce exactly one entry per page (page_number 1..${input.plannedPages}).
- Choose the smallest content kind that teaches the focus. Most topics have a mix.
- A full_page brief MUST include at least one active_processing prompt when it covers a
  dense mechanism, math, procedure, or high-risk misconception.
- Do not re-teach the same concept on two pages — assign distinct concepts per page and
  use later pages to deepen/connect/practice rather than repeat.
- For non-full_page pages, set "brief": null.
- Keep every field compact and implementation-ready.`,
  }
}

export async function analyzeTopicPlan(input: AnalyzeTopicPlanInput): Promise<TopicLessonPlan> {
  const prompt = buildPrompt(input)
  const text = await generateWithGemini({
    ...prompt,
    purpose: 'primary',
    responseMimeType: 'application/json',
  })
  const raw = parseGeminiJson<any>(text)
  const rawPages: any[] = Array.isArray(raw?.pages) ? raw.pages : []

  const pages: TopicPagePlan[] = []
  for (let i = 0; i < input.plannedPages; i++) {
    const pageNumber = i + 1
    const match = rawPages.find((p) => Number(p?.page_number) === pageNumber) ?? rawPages[i]
    const contentKind = normalizeContentKind(match?.content_kind)
    const role = normalizeRole(match?.page_sequence_role)
    const focus = compact(match?.focus, 240) || input.pageFocuses[i] || `Page ${pageNumber} of ${input.topic.title}`

    // Only full_page pages carry a full architecture brief (#3 — skip brief on simple).
    let brief: LearningArchitectureBrief | null = null
    if (contentKind === 'full_page' && match?.brief) {
      const normalized = normalizeBrief(match.brief)
      // Keep the brief only if it passes the same quality gate as the per-page analyzer;
      // otherwise leave it null and let the route fall back to a per-page brief lazily.
      if (validateLearningArchitectureBrief(normalized).length === 0) {
        brief = normalized
      }
    }

    pages.push({ page_number: pageNumber, focus, content_kind: contentKind, page_sequence_role: role, brief })
  }

  return { generated_at: new Date().toISOString(), version: PLAN_VERSION, pages }
}
