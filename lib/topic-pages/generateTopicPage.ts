import crypto from 'crypto'
import { generateWithGemini } from '@/lib/ai/gemini/client'
import { parseGeminiJson } from '@/lib/ai/gemini/json'
import type { CourseMemoryContext } from '@/lib/vector/retrieval'
import type { ConceptKind, ContentKind, LessonExampleRef, LessonSection, LessonSectionType, TopicDepth } from '@/types'

type GenerateTopicPageInput = {
  course: any
  topic: any
  pageNumber?: number
  previousPages?: any[]
  memory?: CourseMemoryContext
  mapPointer?: string
  sequenceContext?: string
  approach?: 'explain_again' | 'go_deeper' | 'simplify' | 'show_example'
  customInstruction?: string
}

export type GeneratedTopicPage = {
  page_number: number
  focus: string
  content: string          // flat joined text — for search / backward compat
  summary: string
  key_concepts: string[]
  topic_depth: TopicDepth
  concept_kind: ConceptKind
  content_kind: ContentKind
  should_generate_page: boolean
  decision_reason: string
  estimated_length: 'short' | 'medium' | 'long'
  requires_quiz: boolean
  covered_concepts: string[]
  reused_concepts: string[]
  reminder_concepts: string[]
  example_refs: LessonExampleRef[]
  sections: LessonSection[]
}

function fallbackPageFocus(topic: any, pageNumber: number) {
  if (pageNumber === 1) return `Introduce ${topic.title}, its role in the course, and the core intuition.`
  return `Continue ${topic.title} with the next necessary concept slice.`
}

function compact(text: string, max = 1400) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}...` : clean
}

function formatPreviousPages(pages: any[] = []) {
  if (!pages.length) return 'No previous pages in this topic yet.'

  return pages
    .slice(-3)
    .map((page) => {
      const focus = page.focus ?? page.summary ?? 'Earlier lesson page'
      const summary = page.summary && page.summary !== focus ? `Summary: ${page.summary}` : null
      const concepts = Array.isArray(page.key_concepts) && page.key_concepts.length
        ? `Key concepts: ${page.key_concepts.join(', ')}`
        : null
      // Always include a content excerpt so the generator sees the actual framing,
      // analogies, and vocabulary used — not just a summary label.
      // 500 chars catches the opening paragraphs where tone and framing are set.
      const excerpt = page.content
        ? `Excerpt: ${compact(String(page.content), 500)}`
        : null
      return [`Page ${page.page_number}: ${focus}`, summary, concepts, excerpt].filter(Boolean).join('\n')
    })
    .join('\n\n')
}

function formatCourseMemory(memory?: CourseMemoryContext) {
  if (!memory) return ''

  const parts: string[] = []

  if (memory.pages.length) {
    const pageLines = memory.pages.map((page) => {
      const lines: string[] = []
      if (page.focus) lines.push(`Focus: ${page.focus}`)
      if (page.summary) lines.push(`Summary: ${page.summary}`)
      // Add a short excerpt so the generator sees the actual vocabulary and framing,
      // not just the summary label. 350 chars is enough to catch the opening explanation.
      const excerpt = compact(page.content, 350)
      if (excerpt) lines.push(`Excerpt: ${excerpt}`)
      return `[${page.topic_title}, p${page.page_number}]\n${lines.join('\n')}`
    }).join('\n\n')
    parts.push(`Related course pages:\n${pageLines}`)
  }

  if (memory.doubtMessages.length) {
    const doubtLines = memory.doubtMessages.map((message) => {
      const where = message.topic_title
        ? `${message.topic_title}${message.page_number ? `, p${message.page_number}` : ''}`
        : 'Earlier'
      return `${message.role.toUpperCase()} [${where}]: ${compact(message.content, 250)}`
    }).join('\n')
    parts.push(`Related prior doubts:\n${doubtLines}`)
  }

  if (memory.sourceChunks.length) {
    const sourceLines = memory.sourceChunks.map((chunk) =>
      `[${chunk.source_title ?? 'Source'}]\n${compact(chunk.content, 500)}`
    ).join('\n\n')
    parts.push(`Related source material:\n${sourceLines}`)
  }

  return parts.length ? parts.join('\n\n') : ''
}

function splitLongParagraph(paragraph: string) {
  const words = paragraph.trim().split(/\s+/)
  if (words.length <= 95) return paragraph.trim()

  const sentences = paragraph
    .replace(/\s+/g, ' ')
    .match(/[^.!?]+[.!?]+["')\]]?|[^.!?]+$/g)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean)

  if (!sentences || sentences.length < 3) return paragraph.trim()

  const chunks: string[] = []
  let current: string[] = []
  let count = 0

  for (const sentence of sentences) {
    const sentenceWords = sentence.split(/\s+/).length
    if (current.length && count + sentenceWords > 75) {
      chunks.push(current.join(' '))
      current = []
      count = 0
    }
    current.push(sentence)
    count += sentenceWords
  }

  if (current.length) chunks.push(current.join(' '))

  return chunks.join('\n\n')
}

function normalizeLessonMarkdown(markdown: string) {
  const blocks = markdown.trim().split(/\n{2,}/)

  return blocks
    .map((block) => {
      const trimmed = block.trim()
      if (!trimmed) return ''
      if (/^(```|#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\|)/m.test(trimmed)) return trimmed
      return splitLongParagraph(trimmed)
    })
    .filter(Boolean)
    .join('\n\n')
}

function isFillerOptionalSection(content: string) {
  const clean = content.toLowerCase()
  return (
    clean.includes('[only include') ||
    clean.includes('placeholder') ||
    clean.includes('not applicable') ||
    clean.includes('no misconception') ||
    clean.includes('there is no common misconception')
  )
}

function optionalSectionAllowedByGuardrails({
  tag,
  meta,
  pageNumber,
  content,
}: {
  tag: LessonSectionType
  meta: {
    topic_depth?: TopicDepth
    concept_kind?: ConceptKind
    needs_prerequisites?: boolean
    needs_key_ideas?: boolean
    needs_misconceptions?: boolean
    needs_examples?: boolean
    needs_checkpoints?: boolean
  }
  pageNumber: number
  content: string
}) {
  if (tag === 'core') return true
  if (isFillerOptionalSection(content)) return false

  const depth = meta.topic_depth ?? 'medium'
  const kind = meta.concept_kind ?? 'mechanism'
  const wordCount = content.trim().split(/\s+/).filter(Boolean).length

  if (tag === 'prerequisites') {
    return Boolean(meta.needs_prerequisites) && pageNumber > 1 && wordCount <= 90
  }

  if (tag === 'key_ideas') {
    const bulletCount = (content.match(/(^|\n)\s*[-*+]\s+/g) ?? []).length
    return Boolean(meta.needs_key_ideas)
      && bulletCount >= 3
      && depth !== 'shallow'
      && !['definition', 'mechanism'].includes(kind)
  }

  if (tag === 'misconceptions') {
    return Boolean(meta.needs_misconceptions)
      && /mistake|wrong|confus|misconception|pitfall|assume/i.test(content)
      && (kind === 'pitfall' || depth === 'deep')
  }

  if (tag === 'examples') {
    return Boolean(meta.needs_examples)
      && wordCount >= 70
      && depth !== 'shallow'
      && ['math', 'procedure', 'comparison', 'pitfall', 'mechanism'].includes(kind)
  }

  if (tag === 'checkpoints') {
    const questionCount = (content.match(/(^|\n)\s*\d+\.\s+/g) ?? []).length
    return Boolean(meta.needs_checkpoints)
      && questionCount >= 2
      && ['math', 'procedure', 'pitfall', 'comparison'].includes(kind)
      && (depth === 'deep' || kind === 'pitfall')
  }

  return false
}

function optionalSectionPriority(
  tag: LessonSectionType,
  meta: {
    topic_depth?: TopicDepth
    concept_kind?: ConceptKind
  },
  content: string,
) {
  const depth = meta.topic_depth ?? 'medium'
  const kind = meta.concept_kind ?? 'mechanism'
  const wordCount = content.trim().split(/\s+/).filter(Boolean).length

  if (tag === 'misconceptions') {
    return kind === 'pitfall' ? 100 : 74
  }

  if (tag === 'checkpoints') {
    if (kind === 'pitfall') return 92
    if (kind === 'math' || kind === 'procedure') return 82
    return 62
  }

  if (tag === 'examples') {
    if (kind === 'math' || kind === 'procedure') return 88
    if (depth === 'deep' && wordCount >= 110) return 78
    return 58
  }

  if (tag === 'key_ideas') {
    if (kind === 'comparison' || kind === 'procedure') return 76
    return 54
  }

  return 0
}

function optionalSectionBudget(meta: { topic_depth?: TopicDepth; concept_kind?: ConceptKind }) {
  const depth = meta.topic_depth ?? 'medium'
  const kind = meta.concept_kind ?? 'mechanism'

  if (kind === 'definition') return 0
  if (depth === 'shallow') return kind === 'pitfall' ? 1 : 0
  if (depth === 'medium') return 1
  return kind === 'pitfall' ? 2 : 2
}

function chooseOptionalSections(
  candidates: LessonSection[],
  meta: {
    topic_depth?: TopicDepth
    concept_kind?: ConceptKind
  },
) {
  const budget = optionalSectionBudget(meta)
  if (budget <= 0 || candidates.length === 0) return []

  const selected = candidates
    .map((section) => ({
      section,
      priority: optionalSectionPriority(section.type, meta, section.content),
    }))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, budget)
    .map((item) => item.section)

  const order = new Map(SECTION_TAGS.map((tag, index) => [tag, index]))
  return selected.sort((a, b) => (order.get(a.type) ?? 0) - (order.get(b.type) ?? 0))
}

// ── Response parser ───────────────────────────────────────────────────────────
// Expected model output:
//
//   <assessment>{ "topic_depth": "...", "focus": "...", ... }</assessment>
//   <prerequisites>...</prerequisites>   ← optional
//   <core>...</core>                     ← always
//   <key_ideas>...</key_ideas>           ← optional
//   <misconceptions>...</misconceptions> ← optional
//   <examples>...</examples>             ← optional
//   <checkpoints>...</checkpoints>       ← optional
//
// Falls back to old <metadata>/<content> format if no <assessment> found.

const SECTION_TAGS: LessonSectionType[] = [
  'prerequisites',
  'core',
  'key_ideas',
  'misconceptions',
  'examples',
  'checkpoints',
]

function extractTag(text: string, tag: string): string | null {
  const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return m ? m[1].trim() : null
}

function parseStructuredResponse(
  text: string,
  fallbackFocus: string,
  pageNumber: number,
): GeneratedTopicPage | null {
  const assessRaw = extractTag(text, 'assessment')
  if (!assessRaw) return null

  const meta = parseGeminiJson<{
    topic_depth?: TopicDepth
    concept_kind?: ConceptKind
    focus?: string
    summary?: string
    key_concepts?: string[]
    needs_prerequisites?: boolean
    needs_key_ideas?: boolean
    needs_examples?: boolean
    needs_misconceptions?: boolean
    needs_checkpoints?: boolean
    content_kind?: ContentKind
    should_generate_page?: boolean
    reason?: string
    estimated_length?: 'short' | 'medium' | 'long'
    requires_quiz?: boolean
    covered_concepts?: string[]
    reused_concepts?: string[]
    reminder_concepts?: string[]
    example_refs?: LessonExampleRef[]
  }>(assessRaw)

  const sections: LessonSection[] = []
  const optionalCandidates: LessonSection[] = []
  for (const tag of SECTION_TAGS) {
    const content = extractTag(text, tag)
    if (
      content &&
      !/^\[[^\]]+\]$/i.test(content.trim()) &&
      optionalSectionAllowedByGuardrails({ tag, meta, pageNumber, content })
    ) {
      const section = { type: tag, content: normalizeLessonMarkdown(content) }
      if (tag === 'core' || tag === 'prerequisites') {
        sections.push(section)
      } else {
        optionalCandidates.push(section)
      }
    }
  }

  sections.push(...chooseOptionalSections(optionalCandidates, meta))

  const shouldGeneratePage = meta.should_generate_page !== false && meta.content_kind !== 'skip'
  if (!shouldGeneratePage) {
    return {
      page_number: pageNumber,
      focus: meta.focus || fallbackFocus,
      content: meta.reason || meta.summary || `${fallbackFocus} is covered by surrounding Traccia nodes.`,
      summary: meta.summary || meta.reason || `${fallbackFocus} does not need a standalone lesson page.`,
      key_concepts: Array.isArray(meta.key_concepts) ? meta.key_concepts : [],
      topic_depth: meta.topic_depth || 'shallow',
      concept_kind: meta.concept_kind || 'definition',
      content_kind: 'skip',
      should_generate_page: false,
      decision_reason: meta.reason || 'This node is better handled as context, a bridge, or part of nearby content.',
      estimated_length: meta.estimated_length || 'short',
      requires_quiz: Boolean(meta.requires_quiz),
      covered_concepts: Array.isArray(meta.covered_concepts) ? meta.covered_concepts : [],
      reused_concepts: Array.isArray(meta.reused_concepts) ? meta.reused_concepts : [],
      reminder_concepts: Array.isArray(meta.reminder_concepts) ? meta.reminder_concepts : [],
      example_refs: Array.isArray(meta.example_refs) ? meta.example_refs : [],
      sections: [],
    }
  }

  const coreSection = sections.find((section) => section.type === 'core')
  if (!coreSection || coreSection.content.trim().length < 350) return null

  // Flat content: join all sections for search indexing
  const content = sections.map((s) => s.content).join('\n\n')

  return {
    page_number: pageNumber,
    focus: meta.focus || fallbackFocus,
    content,
    summary: meta.summary || `${fallbackFocus}, page ${pageNumber}.`,
    key_concepts: Array.isArray(meta.key_concepts) ? meta.key_concepts : [],
    topic_depth: meta.topic_depth || 'medium',
    concept_kind: meta.concept_kind || 'mechanism',
    content_kind: meta.content_kind || 'full_page',
    should_generate_page: true,
    decision_reason: meta.reason || 'This concept needs a standalone generated lesson page.',
    estimated_length: meta.estimated_length || 'medium',
    requires_quiz: Boolean(meta.requires_quiz),
    covered_concepts: Array.isArray(meta.covered_concepts) ? meta.covered_concepts : [],
    reused_concepts: Array.isArray(meta.reused_concepts) ? meta.reused_concepts : [],
    reminder_concepts: Array.isArray(meta.reminder_concepts) ? meta.reminder_concepts : [],
    example_refs: Array.isArray(meta.example_refs) ? meta.example_refs : [],
    sections,
  }
}

// Fallback: old <metadata>/<content> format
function parseOldFormat(
  text: string,
  fallbackFocus: string,
  pageNumber: number,
): GeneratedTopicPage {
  const metaMatch = text.match(/<metadata>([\s\S]*?)<\/metadata>/i)
  const contentMatch = text.match(/<content>([\s\S]*?)<\/content>/i)

  if (metaMatch && contentMatch) {
    const meta = parseGeminiJson<Omit<GeneratedTopicPage, 'sections' | 'topic_depth' | 'concept_kind' | 'content'>>(metaMatch[1].trim())
    const content = normalizeLessonMarkdown(contentMatch[1].trim())
    return {
      page_number: meta.page_number ?? pageNumber,
      focus: meta.focus || fallbackFocus,
      content,
      summary: meta.summary || `${fallbackFocus}, page ${pageNumber}.`,
      key_concepts: Array.isArray(meta.key_concepts) ? meta.key_concepts : [],
      topic_depth: 'medium',
      concept_kind: 'mechanism',
      content_kind: 'full_page',
      should_generate_page: true,
      decision_reason: 'Legacy lesson format produced a full page.',
      estimated_length: 'medium',
      requires_quiz: false,
      covered_concepts: [],
      reused_concepts: [],
      reminder_concepts: [],
      example_refs: [],
      sections: [{ type: 'core', content }],
    }
  }

  // Last resort: raw JSON
  const parsed = parseGeminiJson<any>(text)
  const content = normalizeLessonMarkdown(parsed.content || parsed.core || parsed.explanation || '')
  if (!String(content).trim()) {
    throw new Error('Gemini returned a lesson page with no usable content.')
  }
  return {
    page_number: parsed.page_number ?? pageNumber,
    focus: parsed.focus || fallbackFocus,
    content,
    summary: parsed.summary || `${fallbackFocus}, page ${pageNumber}.`,
    key_concepts: Array.isArray(parsed.key_concepts) ? parsed.key_concepts : [],
    topic_depth: 'medium',
    concept_kind: 'mechanism',
    content_kind: 'full_page',
    should_generate_page: true,
    decision_reason: 'Legacy JSON lesson format produced a full page.',
    estimated_length: 'medium',
    requires_quiz: false,
    covered_concepts: [],
    reused_concepts: [],
    reminder_concepts: [],
    example_refs: [],
    sections: [{ type: 'core', content }],
  }
}

// ── Prompt ────────────────────────────────────────────────────────────────────

const SYSTEM = `You are TruLurn's adaptive lesson writer.
Your job: match the FORMAT to the CONCEPT so the student actually learns — not just reads.
Use paragraphs, bullets, examples, and callouts intelligently based on what each piece of content is.

You also decide whether this Traccia node truly deserves a standalone lesson page.
Do not over-explain simple bridge concepts. A learning unit may be:
- full_page: a standalone lesson page is justified.
- section: a concise teachable section is enough.
- bridge: a short transition between nearby ideas is enough.
- example: a concrete example is the main value.
- skip: no page should be generated because the idea is already covered nearby or is only structural context.
Choose skip carefully. Never skip a concept if skipping would hide a prerequisite, a common source of confusion, or an assessable skill.

TONE & VOICE — follow these without exception:
• Write like a knowledgeable friend explaining something, not a textbook author. Clear and direct, never stiff or overly formal.
• Talk directly to the student. Use "you": "When you call a function..." not "When a function is called..."
• Keep sentences short and clear. If a sentence is doing too much, split it.
• When you introduce a technical term, explain what it means immediately — in the same sentence or the very next one. Don't assume the student already knows it.
• Lead with intuition before definition. Start with what problem this solves, or a real-world analogy, before presenting formal terms.
• Prefer active voice. "Python reads the file" lands better than "the file is read by Python".

STRICT OPTIONAL SECTION POLICY:
- Treat optional sections as false by default. The model must earn each one.
- Most pages should have zero or one separate optional section beyond <core>.
- Shallow definition/orientation pages should usually have no separate optional sections.
- Medium pages may use one optional section if it clearly changes how the learner studies the page.
- Deep or pitfall-heavy pages may use at most two optional sections.
- Never include <key_ideas>, <examples>, <misconceptions>, and <checkpoints> together on the same page.
- Prefer putting small examples, small bullet lists, and small insights inside <core> instead of creating repeated visual blocks.

STEP 1 — ASSESS the concept:
• topic_depth:
    "shallow"  → quick orientation, student needs to recognise this idea
    "medium"   → solid coverage, one concept with its mechanics
    "deep"     → complex or abstract, multiple angles and active reasoning needed
• concept_kind:
    "definition"  → naming/recognition
    "mechanism"   → explains why or how something works
    "procedure"   → steps, algorithm, workflow
    "math"        → formulas, derivations, quantitative reasoning
    "comparison"  → contrasts two or more ideas
    "pitfall"     → commonly misunderstood
• needs_prerequisites → true if there is a specific prior concept the student MUST recall right now
• needs_key_ideas → true when the concept has 3+ distinct takeaways worth separating out visually
• needs_examples → true when a worked example is substantial enough to deserve its own section
  Default true for: procedure, math. Usually true for: mechanism, comparison, pitfall.
• needs_misconceptions → true if there is a specific, high-risk wrong belief about this concept
• needs_checkpoints → true for math, procedure, or pitfall where active self-testing prevents false confidence

STEP 1B - SHAPE THE CONTENT:
• content_kind: "full_page" | "section" | "bridge" | "example" | "skip"
• should_generate_page: false only when content_kind is "skip"
• estimated_length:
    "short"  -> 250-450 words, bridge/section/example
    "medium" -> 550-850 words, normal page
    "long"   -> 900-1200 words, only for deep concepts
• requires_quiz: true only if the node introduces an assessable skill, formula, procedure, or high-risk misconception.
Use the course map pointer to avoid repeating nearby pages and to keep this node scoped.

STEP 1C - SEQUENCE CONTINUITY:
• If the sequence context says a concept was already explained, do not re-teach it from scratch.
  Use either 2-4 short reminder bullets or one compact bridge paragraph.
• If the same concept appears in a new context, explain only the contextual difference.
• Reuse examples listed in the sequence context when they still fit.
  Introduce a new example only when the old one would mislead, hide the current mechanism, or fail for this topic.
• Avoid casually switching analogy domains across adjacent pages.
• Record what you did in assessment.covered_concepts, reused_concepts, reminder_concepts, and example_refs.

STEP 2 — FORMAT RULES: choose the right format for each piece of content

PARAGRAPHS — use for:
• Explaining the "why" and "how" — tell the story of the concept in plain language
• Setting up a concept with intuition before showing its structure
• Connecting ideas to what the student already knows
• Keep each paragraph 2–4 sentences, under 85 words. No walls of prose. If it feels dense, split it.

BULLET LISTS — use for:
• Any 2+ discrete items: properties, types, conditions, components, consequences
• Steps that are parallel but not strictly ordered
• Comparisons between alternatives when prose would be harder to scan
• Do NOT use bullets for continuous explanation — use prose for that.

NUMBERED LISTS — use for:
• Strictly ordered steps, algorithms, procedures.

INLINE CALLOUTS — embed in <core> at the point where they add the most value:

  > **Definition:** [one or two sentence formal definition]
  Use when the concept has a precise meaning students need to pin down.
  Most definition and math concepts benefit from this.

  > **Example: [short descriptive title]**
  > Concrete worked case with real values, steps, or analogies. $math$ inline as needed.
  Use at the exact point where an abstract claim needs grounding.
  Most mechanism, math, and procedure concepts should include at least one example inline.

  > **Key insight:** [one non-obvious takeaway, 1–2 sentences]
  Use for a pinpoint observation students routinely miss or misapply.
  Max 2 per page. Do not use for things the prose already states clearly.

HEADINGS — required structure:
• The very first line of <core> MUST be a ## heading that names the concept clearly and conversationally.
  Good: "## What Is a Loss Function?" / "## How Gradient Descent Works" / "## Why Recursion Needs a Base Case"
  Also good: "## Variables" / "## The Chain Rule" (short and direct is fine)
  Bad:  "## Introduction" / "## Overview" / "## Core Concepts" ← too generic, never use these
• Sub-headings for 2–3 distinct sub-concepts. Keep them direct and specific.
• Max 3 ## headings per <core>.

SEPARATE SECTIONS — use when content earns its own visual block:
• <key_ideas>: use when the concept yields 3+ distinct takeaways worth a bulleted summary.
  Write as a tight bullet list, not prose.
• <examples>: use when a worked example is large enough to clutter <core> if left inline.
  Ideal for multi-step procedures or derivations.
• <misconceptions>: a specific, named wrong belief, and why it is wrong.
• <checkpoints>: 2 self-check questions for math, procedure, or pitfall concepts.

DO NOT PRODUCE FILLER:
• Skip any section that would be padding or an obvious restatement of the prose.
• A <key_ideas> section that just repeats what was already said adds no value — skip it.
• An inline example must have real values, steps, or an analogy — not a vague description.

MATH & FORMATTING:
• Use $...$ for ALL inline math: $f(x)$, $\\lim_{x \\to c}$, $\\frac{a}{b}$
• Use $$...$$ on its own line for display equations
• NEVER use backticks for math — only for code identifiers
• Use **bold** for key terms on first mention only

DEPTH CALIBRATION:
• shallow → core prose + headings + definition callout if the term needs precision. Add a bullet list or inline example if the concept is list-like or abstract.
• medium  → core prose + appropriate bullets + at least one example for non-definition concepts. <key_ideas> or <examples> section if the concept warrants it.
• deep    → full use of all applicable formats. Multiple sub-headings, bullets where list-like, at least one example, <key_ideas> for distinct takeaways, <misconceptions> and/or <checkpoints> if warranted.`

const USER_TEMPLATE = ({
  courseTitle,
  courseGoal,
  topicTitle,
  topicDescription,
  topicDepth,
  pageNumber,
  plannedPages,
  focus,
  previousPages,
  memory,
  mapPointer,
  sequenceContext,
}: {
  courseTitle: string
  courseGoal: string
  topicTitle: string
  topicDescription: string
  topicDepth: string
  pageNumber: number
  plannedPages: number
  focus: string
  previousPages?: any[]
  memory?: CourseMemoryContext
  mapPointer?: string
  sequenceContext?: string
}) => `Course: ${courseTitle}
Goal: ${courseGoal}
Topic: ${topicTitle}
Description: ${topicDescription}
Suggested depth: ${topicDepth}
Page: ${pageNumber} of ${plannedPages}
Page focus: ${focus}

${mapPointer ? `${mapPointer}\n` : ''}
${sequenceContext ? `${sequenceContext}\n` : ''}

Previous pages in this same topic:
${formatPreviousPages(previousPages)}
${(() => { const mem = formatCourseMemory(memory); return mem ? `\nSemantic course memory (use only for continuity/deduplication):\n${mem}\n` : '' })()}

Return in this EXACT format. Only <assessment> and <core> are always required.

<assessment>
{
  "topic_depth": "shallow|medium|deep",
  "concept_kind": "definition|mechanism|procedure|math|comparison|pitfall",
  "focus": "${focus}",
  "summary": "2-3 sentence summary: what mechanism or concept was explained, what framing or analogy was used, and what vocabulary was formally introduced",
  "key_concepts": ["concept one", "concept two"],
  "needs_prerequisites": false,
  "needs_key_ideas": false,
  "needs_examples": false,
  "needs_misconceptions": false,
  "needs_checkpoints": false,
  "content_kind": "full_page|section|bridge|example|skip",
  "should_generate_page": true,
  "reason": "why this node deserves this content shape",
  "estimated_length": "short|medium|long",
  "requires_quiz": false,
  "covered_concepts": ["concept explained or materially advanced on this page"],
  "reused_concepts": ["prior concept referenced without re-teaching"],
  "reminder_concepts": ["prior concept summarized only as a short hint"],
  "example_refs": [
    {
      "label": "short example label",
      "topic_title": "source topic title or null",
      "page_number": 1,
      "excerpt": "short reused or adapted example note"
    }
  ]
}
</assessment>

RULES:
- Always include <core> unless should_generate_page is false.
- If should_generate_page is false, return only <assessment> and no other tags.
- If content_kind is section, bridge, or example, keep <core> concise and do not pad to look like a full lesson.
- Default to no optional sections. Include a separate optional section only when it changes how the learner studies the page.
- Do not include more than one of <key_ideas>, <examples>, <misconceptions>, and <checkpoints> on a medium page.
- Do not include more than two of <key_ideas>, <examples>, <misconceptions>, and <checkpoints> on a deep page.
- Do not include separate optional sections on shallow definition/orientation pages unless there is a real pitfall.
- Include <prerequisites> only when needs_prerequisites is true.
- Include <key_ideas> only when needs_key_ideas is true.
- Include <examples> only when needs_examples is true.
- Include <misconceptions> only when needs_misconceptions is true.
- Include <checkpoints> only when needs_checkpoints is true.
- Omit any section whose flag is false. No placeholder text.
- When using an earlier idea, record it in reused_concepts or reminder_concepts.
- When reusing or adapting an example, include it in example_refs.

<prerequisites>
[Only if needs_prerequisites is true — 2–4 sentences on what the student must already know]
</prerequisites>

<core>
## [Concept name — specific, not generic]

[Mix paragraphs, bullet lists, and inline callouts based on what the content is:]

> **Definition:** [Formal definition when the concept needs precise language]

[Paragraphs for narrative explanation, cause-effect reasoning]

[Bullet list for 2+ discrete items: properties, types, steps, conditions]
- Item one
- Item two

> **Example: [short descriptive title]**
> Concrete worked case with real values or steps. $math$ as needed.

> **Key insight:** [Non-obvious takeaway students routinely miss]

[Use ## sub-headings to separate distinct sub-concepts. Max 3.]
LaTeX freely: $f(x)$, $$\\lim_{x \\to c} f(x) = L$$
</core>

<key_ideas>
[Only if needs_key_ideas is true — a tight bullet list of 3+ distinct takeaways]
- [Takeaway one]
- [Takeaway two]
- [Takeaway three]
</key_ideas>

<examples>
[Only if needs_examples is true — a worked example that would clutter <core> if left inline]
**Example: [descriptive title]**
[Step-by-step walkthrough with real values or concrete scenario]
</examples>

<misconceptions>
[Only if needs_misconceptions is true]
**Common mistake:** What students wrongly believe.
**Reality:** The correct understanding, and why the mistake is tempting.
</misconceptions>

<checkpoints>
[Only if needs_checkpoints is true]
**Think through this** (no need to write it down — just reason it out):

1. [Question that tests core understanding — not trivial recall.]
   > *Hint: [One sentence that points without giving the answer.]*

2. [Second question that applies or extends the concept.]
   > *Hint: [One sentence hint.]*
</checkpoints>`

// ── Main ─────────────────────────────────────────────────────────────────────

const APPROACH_INSTRUCTIONS: Record<string, string> = {
  explain_again: 'REGENERATION MODE: Explain from scratch using a completely different angle, analogy, or starting point than any previous explanation. Do not repeat the same framing.',
  go_deeper: 'REGENERATION MODE: Go significantly deeper than usual. Explore nuance, edge cases, underlying mechanisms, and mathematical/formal treatment where relevant. Assume the student already has basic familiarity.',
  simplify: 'REGENERATION MODE: Simplify aggressively. Use plain language, minimal jargon, and a concrete analogy or everyday comparison. Prioritise intuition over precision.',
  show_example: 'REGENERATION MODE: Lead with concrete, worked examples. Every abstract claim should be grounded in a real or illustrative case. Use numbers, code snippets, or step-by-step walkthroughs.',
}

const COURSE_DEPTH_INSTRUCTIONS: Record<string, string> = {
  low: `COURSE DEPTH: Low — This course is set to overview level.
- Keep explanations concise. Prioritise clarity and the core intuition.
- Skip advanced nuances, edge cases, and supplementary content — a student should understand the essentials, not every detail.
- Prefer one clear example over multiple variations.
- A focused, shorter page is better than a comprehensive but overwhelming one.`,
  high: `COURSE DEPTH: High — This course is set to mastery level.
- Provide thorough coverage. Include deeper reasoning, advanced nuances, and edge cases where they add genuine value.
- Multiple examples are encouraged when they each illuminate a different angle.
- The student expects a complete treatment — do not shy away from detail or complexity.
- Only add depth where it genuinely aids understanding; do not pad.`,
}

export async function generateTopicPage({
  course,
  topic,
  pageNumber = 1,
  previousPages = [],
  memory,
  mapPointer,
  sequenceContext,
  approach,
  customInstruction,
}: GenerateTopicPageInput): Promise<GeneratedTopicPage> {
  const plannedPages = topic.estimated_pages ?? topic.total_pages_planned ?? 3
  const focus = customInstruction
    ? customInstruction
    : (topic.page_focuses?.[pageNumber - 1]?.focus ?? fallbackPageFocus(topic, pageNumber))

  const depthKey = String(course.course_depth ?? 'standard')
  const depthBlock = COURSE_DEPTH_INSTRUCTIONS[depthKey]
    ? `\n${COURSE_DEPTH_INSTRUCTIONS[depthKey]}\n`
    : ''
  const approachBlock = approach ? `\n${APPROACH_INSTRUCTIONS[approach] ?? ''}\n` : ''
  const customBlock = customInstruction
    ? `\nCUSTOM PAGE REQUEST: "${customInstruction}"\nGenerate this page in response to the student's specific request. The focus above reflects their intent.\n`
    : ''

  const user = [depthBlock, approachBlock, customBlock, USER_TEMPLATE({
    courseTitle: course.title ?? course.topic,
    courseGoal: course.goals ?? 'Master the subject clearly enough to explain and apply it.',
    topicTitle: topic.title,
    topicDescription: topic.description ?? topic.summary ?? 'No description stored.',
    topicDepth: topic.depth ?? 'medium',
    pageNumber,
    plannedPages,
    focus,
    previousPages,
    memory,
    mapPointer,
    sequenceContext,
  })].filter(Boolean).join('')

  const text = await generateWithGemini({
    system: SYSTEM,
    user,
    purpose: 'primary',
    responseMimeType: 'text/plain',
  })

  const structured = parseStructuredResponse(text, focus, pageNumber)
  if (structured) return structured

  const parsed = parseOldFormat(text, focus, pageNumber)
  const hasContent = parsed.content.trim().length > 0
  const hasSectionContent = parsed.sections.some((section) => section.content.trim().length > 0)

  if (!hasContent && !hasSectionContent) {
    throw new Error('Generated lesson page was empty.')
  }

  return parsed
}

// ── Document builder ──────────────────────────────────────────────────────────

export function buildPageDocument(input: {
  courseId: string
  topicId: string
  userId: string
  page: GeneratedTopicPage
}) {
  return {
    _id: crypto.randomUUID() as any,
    course_id: input.courseId,
    topic_id: input.topicId,
    user_id: input.userId,
    page_number: input.page.page_number,
    focus: input.page.focus,
    content: input.page.content,
    summary: input.page.summary,
    key_concepts: input.page.key_concepts,
    topic_depth: input.page.topic_depth,
    concept_kind: input.page.concept_kind,
    content_kind: input.page.content_kind,
    should_generate_page: input.page.should_generate_page,
    decision_reason: input.page.decision_reason,
    estimated_length: input.page.estimated_length,
    requires_quiz: input.page.requires_quiz,
    covered_concepts: input.page.covered_concepts,
    reused_concepts: input.page.reused_concepts,
    reminder_concepts: input.page.reminder_concepts,
    example_refs: input.page.example_refs,
    sections: input.page.sections,
    created_at: new Date(),
    updated_at: new Date(),
  }
}
