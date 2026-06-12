import { parseAIJson, searchAI, type AIWebSource } from '@/lib/ai'
import type { CourseDepth, LearningControlMode } from '@/lib/ai/skills/types'

export type CurriculumResearchConfidence = 'low' | 'medium' | 'high'

export type CourseResearchReport = {
  subject: string
  research_confidence: CurriculumResearchConfidence
  source_budget: {
    target_min: number
    target_max: number
    search_context_size: 'low' | 'medium' | 'high'
  }
  sources: AIWebSource[]
  source_mix: {
    university_or_syllabus: string[]
    textbook_or_toc: string[]
    industry_or_practical: string[]
    history_or_overview: string[]
  }
  recurring_concepts: string[]
  foundational_concepts: string[]
  intermediate_concepts: string[]
  advanced_concepts: string[]
  historical_progression: string[]
  missing_risk_checklist: string[]
  optional_or_niche_topics: string[]
  validation_brief: string
  optimization_brief: string
}

type RawResearchReport = Omit<CourseResearchReport, 'sources' | 'source_budget'> & {
  sources?: AIWebSource[]
}

type ResearchInput = {
  goals: string
  courseDepth: CourseDepth
  learningControl: LearningControlMode
}

function budgetForDepth(depth: CourseDepth) {
  if (depth === 'low') {
    return { target_min: 3, target_max: 5, search_context_size: 'low' as const }
  }
  if (depth === 'high') {
    return { target_min: 8, target_max: 12, search_context_size: 'high' as const }
  }
  return { target_min: 5, target_max: 8, search_context_size: 'medium' as const }
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .slice(0, 24)
}

function normalizeSources(modelSources: unknown, apiSources: AIWebSource[]) {
  const byUrl = new Map<string, AIWebSource>()
  const add = (source: unknown) => {
    if (!source || typeof source !== 'object') return
    const record = source as Record<string, unknown>
    const url = typeof record.url === 'string' ? record.url.trim() : ''
    if (!url || byUrl.has(url)) return

    let domain: string | undefined
    try {
      domain = new URL(url).hostname.replace(/^www\./, '')
    } catch {
      domain = typeof record.domain === 'string' ? record.domain : undefined
    }

    byUrl.set(url, {
      url,
      title: typeof record.title === 'string' ? record.title.trim() : undefined,
      domain,
    })
  }

  apiSources.forEach(add)
  if (Array.isArray(modelSources)) modelSources.forEach(add)
  return Array.from(byUrl.values()).slice(0, 16)
}

function normalizeReport(raw: RawResearchReport, input: ResearchInput, apiSources: AIWebSource[]): CourseResearchReport {
  const budget = budgetForDepth(input.courseDepth)
  const sources = normalizeSources(raw.sources, apiSources)
  const confidence: CurriculumResearchConfidence =
    raw.research_confidence === 'high' || raw.research_confidence === 'medium' || raw.research_confidence === 'low'
      ? raw.research_confidence
      : sources.length >= budget.target_min
        ? 'medium'
        : 'low'

  return {
    subject: String(raw.subject ?? input.goals).trim().slice(0, 120),
    research_confidence: sources.length < budget.target_min ? 'low' : confidence,
    source_budget: budget,
    sources,
    source_mix: {
      university_or_syllabus: normalizeStringArray(raw.source_mix?.university_or_syllabus),
      textbook_or_toc: normalizeStringArray(raw.source_mix?.textbook_or_toc),
      industry_or_practical: normalizeStringArray(raw.source_mix?.industry_or_practical),
      history_or_overview: normalizeStringArray(raw.source_mix?.history_or_overview),
    },
    recurring_concepts: normalizeStringArray(raw.recurring_concepts),
    foundational_concepts: normalizeStringArray(raw.foundational_concepts),
    intermediate_concepts: normalizeStringArray(raw.intermediate_concepts),
    advanced_concepts: normalizeStringArray(raw.advanced_concepts),
    historical_progression: normalizeStringArray(raw.historical_progression),
    missing_risk_checklist: normalizeStringArray(raw.missing_risk_checklist),
    optional_or_niche_topics: normalizeStringArray(raw.optional_or_niche_topics),
    validation_brief: String(raw.validation_brief ?? '').trim().slice(0, 2500),
    optimization_brief: String(raw.optimization_brief ?? '').trim().slice(0, 2500),
  }
}

export function formatResearchBrief(report?: CourseResearchReport | null) {
  if (!report) return ''

  return [
    `Research confidence: ${report.research_confidence}`,
    `Sources consulted: ${report.sources.map((source) => source.domain ?? source.title ?? source.url).join(', ') || 'none recorded'}`,
    `Recurring expert-taught concepts: ${report.recurring_concepts.join(', ') || 'none recorded'}`,
    `Foundational concepts: ${report.foundational_concepts.join(', ') || 'none recorded'}`,
    `Intermediate concepts: ${report.intermediate_concepts.join(', ') || 'none recorded'}`,
    `Advanced concepts: ${report.advanced_concepts.join(', ') || 'none recorded'}`,
    `Historical progression: ${report.historical_progression.join(' -> ') || 'none recorded'}`,
    `Missing-risk checklist: ${report.missing_risk_checklist.join(', ') || 'none recorded'}`,
    `Optional or niche topics: ${report.optional_or_niche_topics.join(', ') || 'none recorded'}`,
    `Curriculum validation brief: ${report.validation_brief || 'none'}`,
    `Curriculum optimization brief: ${report.optimization_brief || 'none'}`,
  ].join('\n')
}

// ── Lesson-level concept research ─────────────────────────────────────────────
// A narrow, cheap search run per lesson page — not broad curriculum research.
// Anchors the lesson prose to real explanations and terminology so the model
// doesn't hallucinate definitions, edge cases, or example values.

export type LessonResearchResult = {
  found: boolean
  context: string
  sources: AIWebSource[]
}

export async function researchLessonConcept({
  courseTitle,
  topicTitle,
  focus,
}: {
  courseTitle: string
  topicTitle: string
  focus: string
}): Promise<LessonResearchResult> {
  try {
    const { text, sources } = await searchAI({
      feature: 'lesson_research',
      searchContextSize: 'low',
      system: `You are TruLurn's lesson fact-checker.
Find concise, accurate information about the specific concept being taught.
Extract: the standard definition or mechanism, one concrete worked example if available, one well-documented common misconception if any.
Be brief and precise — this is a factual anchor for a lesson page, not a full explanation.
Return plain text only. Do not reproduce large passages from sources.`,
      user: `Course: ${courseTitle}
Topic: ${topicTitle}
Page focus: ${focus}

Find accurate pedagogical information about this specific concept.
Return: standard definition or mechanism (2–3 sentences), a concrete worked example with real values, any well-documented misconception.
Keep total length under 400 words.`,
    })

    if (!text.trim() || text.length < 40) return { found: false, context: '', sources: [] }

    const sourceNote = sources.length
      ? `\nSources consulted: ${sources.slice(0, 4).map((s) => s.domain ?? s.title ?? s.url).join(', ')}`
      : ''

    return {
      found: true,
      context: text.trim().slice(0, 2200) + sourceNote,
      sources,
    }
  } catch {
    // Non-fatal — lesson generation continues without research context
    return { found: false, context: '', sources: [] }
  }
}

// ── Curriculum research ────────────────────────────────────────────────────────

export async function researchCurriculum(input: ResearchInput): Promise<CourseResearchReport> {
  const budget = budgetForDepth(input.courseDepth)
  const { text, sources } = await searchAI({
    feature: 'curriculum_research',
    responseMimeType: 'application/json',
    searchContextSize: budget.search_context_size,
    system: `You are TruLurn's bounded curriculum research analyst.
Use web search exactly as a fast calibration pass, not deep research.
Extract curriculum structure, sequencing, and recurring concepts from reputable educational sources.
Do not reproduce source materials. Return only valid JSON.`,
    user: `Research the requested course quickly but seriously.

Learner request:
${input.goals}

Progression mode: ${input.learningControl}
Depth: ${input.courseDepth}
Source budget: use roughly ${budget.target_min}-${budget.target_max} reputable sources when available.

Prefer a diverse source mix:
- university syllabus or course outline
- textbook table of contents or book/course structure
- reputable industry or practical training program
- historical or field overview source if the subject has important evolution

Thinking Layer 1: Curriculum Validation
- Identify recurring concepts across sources.
- Identify missing concepts, redundancies, weak sequencing, and noisy optional areas.
- Separate core concepts from optional/niche topics.

Thinking Layer 2: Curriculum Optimization
- Produce a compact curriculum guidance brief better than any one source.
- Improve topic ordering for learning efficiency.
- Preserve essential depth without padding.

Return this exact JSON shape:
{
  "subject": "short subject name",
  "research_confidence": "low|medium|high",
  "sources": [
    { "title": "source title", "url": "https://...", "domain": "example.edu" }
  ],
  "source_mix": {
    "university_or_syllabus": ["short source note"],
    "textbook_or_toc": ["short source note"],
    "industry_or_practical": ["short source note"],
    "history_or_overview": ["short source note"]
  },
  "recurring_concepts": ["concept experts consistently include"],
  "foundational_concepts": ["must-know early concepts"],
  "intermediate_concepts": ["middle layer concepts"],
  "advanced_concepts": ["advanced concepts"],
  "historical_progression": ["older idea", "later idea", "modern idea"],
  "missing_risk_checklist": ["critical concept the curriculum must not skip"],
  "optional_or_niche_topics": ["topic to include only if useful"],
  "validation_brief": "compact validation of what complete coverage requires",
  "optimization_brief": "clear guidance for the curriculum builder"
}

Rules:
- Keep arrays concise. Prefer high-signal concepts over long lists.
- Mark research_confidence low if sources are thin, generic, or not diverse.
- Do not invent URLs.
- Do not include prose outside JSON.`,
  })

  const raw = parseAIJson<RawResearchReport>(text)
  return normalizeReport(raw, input, sources)
}
