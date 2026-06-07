import crypto from 'crypto'
import { generateWithGemini } from '@/lib/ai/gemini/client'
import { parseGeminiJson } from '@/lib/ai/gemini/json'
import { buildStyleDirective } from '@/lib/ai/skills/lessonStyle'
import type { CourseMemoryContext } from '@/lib/vector/retrieval'
import type { LearningArchitectureBrief } from '@/lib/learning-architecture/analyzePage'
import type { ConceptKind, ContentKind, LessonExampleRef, LessonSection, LessonSectionType, TopicDepth } from '@/types'

type GenerateTopicPageInput = {
  course: any
  topic: any
  pageNumber?: number
  previousPages?: any[]
  memory?: CourseMemoryContext
  mapPointer?: string
  sequenceContext?: string
  learningArchitecture?: LearningArchitectureBrief
  approach?: 'explain_again' | 'go_deeper' | 'simplify' | 'show_example'
  customInstruction?: string
  lessonResearch?: string
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
  learning_architecture?: LearningArchitectureBrief | null
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

function formatLearningArchitecture(brief?: LearningArchitectureBrief) {
  if (!brief) return ''

  const active = [
    brief.active_processing.retrieval_prompt ? `Retrieval: ${brief.active_processing.retrieval_prompt}` : null,
    brief.active_processing.self_explanation_prompt ? `Self-explanation: ${brief.active_processing.self_explanation_prompt}` : null,
    brief.active_processing.transfer_prompt ? `Transfer: ${brief.active_processing.transfer_prompt}` : null,
  ].filter(Boolean)

  return [
    'LEARNING ARCHITECTURE BRIEF:',
    `Target understanding: ${brief.target_understanding}`,
    `Success criteria: ${brief.success_criteria.join('; ') || 'none'}`,
    `Why this matters now: ${brief.why_this_matters_now}`,
    `Prior knowledge: ${brief.required_prior_knowledge.join('; ') || 'none'}`,
    brief.prior_knowledge_repair.length ? `Prior knowledge repair: ${brief.prior_knowledge_repair.join('; ')}` : null,
    brief.likely_misconceptions.length ? `Misconception risks: ${brief.likely_misconceptions.join('; ')}` : null,
    `Intuition plan: ${brief.intuition_plan}`,
    `Representation plan: ${brief.representation_plan.join('; ') || 'prose'}`,
    `Example strategy: opening=${brief.example_strategy.opening_example || 'none'}; worked_example_needed=${brief.example_strategy.worked_example_needed}; contrast_case_needed=${brief.example_strategy.contrast_case_needed}; reusable=${brief.example_strategy.reusable_example_refs.join('; ') || 'none'}`,
    active.length ? `Active processing: ${active.join('; ')}` : 'Active processing: none',
    `Page role: ${brief.page_sequence_role}`,
    `Cross-page connection: ${brief.cross_page_connection}`,
    brief.cognitive_load_notes.length ? `Cognitive-load notes: ${brief.cognitive_load_notes.join('; ')}` : null,
    `Recommended content kind: ${brief.recommended_content_kind}`,
    `Planner reason: ${brief.reason}`,
  ].filter(Boolean).join('\n')
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
      && kind !== 'definition'
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

LEARNING ARCHITECTURE:
- When a Learning Architecture Brief is supplied, follow it as the teaching design.
- Do not invent a different page role, example strategy, or content kind.
- The page should create the stated target understanding and satisfy the success criteria.
- Use the suggested intuition before formalism unless the page role is review or practice.
- If active-processing prompts are supplied, include them naturally in <checkpoints> or in the closing part of <core>.
- If the brief says a worked example is needed, include a real worked example.
- If the brief names misconception risks, address the specific risk without turning every page into a misconception page.

TONE & VOICE — follow these without exception:
• Write like a teacher who genuinely loves this subject. Not a textbook author, not a dry lecturer — someone who can't wait to show the student something that clicks. That energy should come through in the prose.
• Let natural enthusiasm appear where the concept earns it. Phrases like "here's where it gets interesting", "this is the key insight", "and this is why it all fits together" are fine — use them when the moment genuinely calls for it, not as filler. Never use hollow affirmations ("Great!", "Awesome!", "Excellent question!") — those are hollow. Real enthusiasm is specific.
• Talk directly to the student. Use "you": "When you train a model..." not "When a model is trained..."
• Keep sentences short and punchy. If a sentence is doing too much, split it. Short sentences land harder.
• When you introduce a technical term, explain what it means immediately — in the same sentence or the very next one. Don't assume the student already knows it.
• Lead with intuition before definition. Start with the question this concept answers, or a real-world analogy that makes it feel familiar, before presenting formal terms.
• Prefer active voice. "The network adjusts its weights" lands better than "the weights are adjusted by the network".
• Avoid blunt one-sentence claims dropped without context. Instead of "Deep Learning learns features automatically.", say "This is what separates deep learning from classical ML: instead of you deciding which features matter, the network figures that out on its own — and it often finds patterns you'd never think to look for."

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

STEP 1C - SEQUENCE CONTINUITY (anti-redundancy rules — read carefully):
The previous pages context is your single most important anti-repetition tool. Before writing anything, scan it for concepts already explained. Then apply these rules strictly:

RULE 1 — Never re-teach what a previous page already taught.
If a concept was explained on an earlier page, you must NOT explain it again as if the student hasn't seen it. This is the most common mistake. The student has read those pages. Treat them as knowledge the student already has.

RULE 2 — Reference it briefly, then move on.
When you need to mention a concept from a previous page, do it in ONE sentence using a callback phrase, then continue. Good callback forms:
  "As we covered earlier, [one-phrase reminder] — so here we're building on that to..."
  "You already know that [thing]. What's new here is..."
  "Remember: [one-line reminder]. With that in mind, let's look at..."
  "We established earlier that [thing], which means..."
Use these naturally, as a teacher would when continuing a running lesson. Do not use them mechanically on every page — only when you genuinely need to invoke prior knowledge.

RULE 3 — The test: would a teacher re-say this?
Ask yourself: if you were teaching this live and had already covered this concept 10 minutes ago, would you repeat the full explanation? No — you'd say "as we just saw" and move on. Apply that instinct here.

RULE 4 — Contextual re-use is fine; re-teaching is not.
If the same concept appears in a genuinely new role (e.g., backpropagation is mentioned in the loss function page just to establish a link, then taught in depth on its own page), a one-sentence bridge is correct. A full re-explanation of what backpropagation is would be wrong.

RULE 5 — Reuse examples when they still fit.
If the sequence context names a prior example, re-use it by reference: "using the same image classification example..." rather than re-describing it from scratch.

• Record what you did: covered_concepts (newly taught), reused_concepts (referenced without re-teaching), reminder_concepts (one-line callback used), example_refs (prior examples reused or adapted).

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
  Inline example callouts are for short paragraph examples only.
  Do NOT put display equations, matrices, or multi-line derivations inside a > blockquote callout.
  If an example needs a matrix, derivation, table, code block, or multiple displayed equations, put it in <examples> instead.

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
• Use $$...$$ only as standalone display-math fences.
• A display equation MUST be formatted exactly like:
  $$
  \\lim_{x \\to c} f(x) = L
  $$
• Never put prose on the same line as $$.
• Never write patterns like "$$ then $$", "$$ if", "$$ where", "$$ Thus", or "$$ Then".
• Never place two display-math fences on the same line.
• Any \\begin{bmatrix}, \\frac, \\mathbb, \\cdot, \\quad, multi-line derivation, or matrix/vector calculation MUST be inside a standalone $$ block.
• If a display equation appears after prose, close the prose sentence first, then start the $$ block on the next line.
• If prose follows a display equation, close the $$ block first, leave a blank line, then write the prose.
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
  learningArchitecture,
  lessonResearch,
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
  learningArchitecture?: LearningArchitectureBrief
  lessonResearch?: string
}) => `Course: ${courseTitle}
Goal: ${courseGoal}
Topic: ${topicTitle}
Description: ${topicDescription}
Suggested depth: ${topicDepth}
Page: ${pageNumber} of ${plannedPages}
Page focus: ${focus}

${mapPointer ? `${mapPointer}\n` : ''}
${sequenceContext ? `${sequenceContext}\n` : ''}
${learningArchitecture ? `${formatLearningArchitecture(learningArchitecture)}\n` : ''}

Previous pages in this same topic:
${formatPreviousPages(previousPages)}
${(() => { const mem = formatCourseMemory(memory); return mem ? `\nSemantic course memory (use only for continuity/deduplication):\n${mem}\n` : '' })()}
${lessonResearch ? `\nWEB RESEARCH CONTEXT — verified facts from reputable sources. Use as a factual anchor. Do not copy verbatim; adapt to your voice and format:\n${lessonResearch}\n` : ''}
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
- If a Learning Architecture Brief recommends a content_kind, match it exactly unless should_generate_page is false.
- The page must visibly support target_understanding, why_this_matters_now, intuition_plan, and cross_page_connection from the brief.
- If the brief requires a worked example, include an inline example or <examples>.
- If the brief has active_processing prompts, include them as <checkpoints> when appropriate or weave them into <core>.
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
> Keep inline callout examples short. Use only inline math here.

> **Key insight:** [Non-obvious takeaway students routinely miss]

[Use ## sub-headings to separate distinct sub-concepts. Max 3.]
Inline math example: $f(x)$

Display math example:
$$
\\lim_{x \\to c} f(x) = L
$$

Matrix example:
$$
x = \\begin{bmatrix} 2 \\\\ -1 \\\\ 3 \\end{bmatrix}
$$
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
[For matrices, vectors, derivations, or multi-step formulas, use standalone $$ blocks only. Never mix $$ with prose on the same line.]
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

// ── Code augmentation directive ───────────────────────────────────────────────
// Fired when course.code_language is set. This is NOT code_first style —
// the concept still leads; code appears only when it genuinely helps.
function buildCodeAugmentationDirective(lang: string): string {
  const label = lang.charAt(0).toUpperCase() + lang.slice(1)
  return `CODE AUGMENTATION — ${label} examples (use your own judgment, only when genuinely helpful):
The student wants ${label} code where it makes concepts clearer. This does NOT mean adding code to every page.

ADD code when:
- The concept is an algorithm, formula, or computation that a short snippet makes tangible (e.g. gradient computation, convolution, attention)
- The concept is an API or library pattern the student will actually use (e.g. defining a PyTorch layer, fitting a sklearn model)
- A concrete implementation reveals *why* the math or theory takes the form it does

SKIP code when:
- The concept is purely motivational, historical, or conceptual ("What is a neural network?", "Why do we need normalisation?")
- The concept is better understood through analogy or prose first
- The page is already code-heavy from previous pages on the same topic

CODE STYLE:
- Keep snippets short: 5–20 lines. Remove all unnecessary boilerplate — show only what matters.
- Use real library names (NumPy, PyTorch, TensorFlow, scikit-learn, Keras, etc.) — pick whichever is most natural for the specific concept.
- Add a brief comment on each non-obvious line.
- Format as a fenced code block: \`\`\`${lang.toLowerCase()}
- If a snippet immediately follows prose, add a blank line before the fence.
- A page can have zero, one, or two snippets — never add more unless the concept genuinely requires it.`
}

export async function generateTopicPage({
  course,
  topic,
  pageNumber = 1,
  previousPages = [],
  memory,
  mapPointer,
  sequenceContext,
  learningArchitecture,
  approach,
  customInstruction,
  lessonResearch,
}: GenerateTopicPageInput): Promise<GeneratedTopicPage> {
  const plannedPages = topic.estimated_pages ?? topic.total_pages_planned ?? 3
  const focus = customInstruction
    ? customInstruction
    : (topic.page_focuses?.[pageNumber - 1]?.focus ?? fallbackPageFocus(topic, pageNumber))

  const depthKey = String(course.course_depth ?? 'standard')
  const depthBlock = COURSE_DEPTH_INSTRUCTIONS[depthKey]
    ? `\n${COURSE_DEPTH_INSTRUCTIONS[depthKey]}\n`
    : ''
  const styleDirective = buildStyleDirective(course.lesson_style ?? null)
  const styleBlock = styleDirective ? `\n${styleDirective}\n` : ''
  const codeLang = String(course.code_language ?? '').trim().toLowerCase()
  const codeBlock = codeLang ? `\n${buildCodeAugmentationDirective(codeLang)}\n` : ''
  const approachBlock = approach ? `\n${APPROACH_INSTRUCTIONS[approach] ?? ''}\n` : ''
  const customBlock = customInstruction
    ? `\nCUSTOM PAGE REQUEST: "${customInstruction}"\nGenerate this page in response to the student's specific request. The focus above reflects their intent.\n`
    : ''

  const user = [depthBlock, styleBlock, codeBlock, approachBlock, customBlock, USER_TEMPLATE({
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
    learningArchitecture,
    lessonResearch,
  })].filter(Boolean).join('')

  const text = await generateWithGemini({
    system: SYSTEM,
    user,
    purpose: 'primary',
    responseMimeType: 'text/plain',
  })

  const structured = parseStructuredResponse(text, focus, pageNumber)
  if (structured) return { ...structured, learning_architecture: learningArchitecture ?? null }

  const parsed = parseOldFormat(text, focus, pageNumber)
  const hasContent = parsed.content.trim().length > 0
  const hasSectionContent = parsed.sections.some((section) => section.content.trim().length > 0)

  if (!hasContent && !hasSectionContent) {
    throw new Error('Generated lesson page was empty.')
  }

  return { ...parsed, learning_architecture: learningArchitecture ?? null }
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
    learning_architecture: input.page.learning_architecture ?? null,
    target_understanding: input.page.learning_architecture?.target_understanding ?? null,
    success_criteria: input.page.learning_architecture?.success_criteria ?? [],
    active_processing: input.page.learning_architecture?.active_processing ?? null,
    retention_hooks: input.page.learning_architecture?.retention_hooks ?? null,
    page_sequence_role: input.page.learning_architecture?.page_sequence_role ?? null,
    sections: input.page.sections,
    created_at: new Date(),
    updated_at: new Date(),
  }
}
