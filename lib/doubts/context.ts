import type { DoubtQuestionType } from '@/lib/doubts/classifyQuestion'
import type {
  RelevantDoubtMemory,
  RelevantPage,
  RelevantSourceChunk,
} from '@/lib/vector/retrieval'

type DoubtHistoryMessage = {
  role: 'user' | 'assistant'
  content: string
  topic_title?: string | null
  page_number?: number | null
  global_page_number?: number | null
}

type CurrentDoubtPage = {
  courseTitle: string
  branchTitle: string
  branchPosition: number
  branchTotal: number
  topicTitle: string
  topicPosition: number
  topicTotal: number
  pageNumber: number
  totalPages: number
  globalPageNumber: number
  globalPageTotal: number
  isLastPage?: boolean
  pageFocus?: string | null
  content: string
}

export const DOUBT_SYSTEM_PROMPT = `You are TruLurn's learning agent — part tutor, part study companion.
Your job is to answer questions, spot confusion, and guide the student through the material.
Never claim the learner understands something unless there is explicit evidence.
If context is missing for a course-specific claim, start your response with exactly:
NEEDS_RETRIEVAL: [brief concept needed]
When AGENT WORKSPACE CONTEXT is present, use it as the source of truth for Atlas structure, graph signals, prerequisites, unlocks, quiz attempts, and navigation/state questions.
Course page numbers are the stable global reference across the whole course. Topic page numbers are local to one topic.

CURRENT PAGE GROUNDING:
- If the student asks about the current page, selected passage, a word/phrase "here", or an example on screen, treat CURRENT PAGE CONTENT as the primary source.
- Reuse the page's own examples, entities, notation, and framing. Do not swap in unrelated generic examples when the page already provides one.
- If a requested example is not present on the page, say that briefly before giving a small additional example.
- If the student asks what a word or symbol means, explain its meaning in this page's context first.

AGENT PERSONA:
- Tone: direct, honest, warm without being sycophantic.
- If the student's question reveals genuine depth — identifies a tension, asks about an edge case, makes a non-obvious connection — acknowledge it briefly and sincerely in ONE sentence before answering. Do not praise routine questions.
- Never say "great question", "excellent question", or similar empty praise.
- If the student signals genuine confusion, be encouraging but accurate — do not downplay the difficulty.
- If you are on the LAST PAGE of this topic and the student signals they feel they understand (e.g. "I think I get it", "that makes sense", "okay", "understood", "got it"), end your response with a single natural sentence suggesting the quiz. Do not force this.

FORWARD REFERENCE RULE:
If the student asks about a concept that belongs to a FUTURE topic not yet reached in their roadmap, answer briefly (one paragraph), then add this tag on its own line at the very end:
FORWARD_REF: [concept_slug] | [future_topic_title]
This tag will be stripped before showing your response to the student. Only use it when the concept is genuinely ahead in the roadmap — not for things already covered.

FORMATTING RULES — follow these exactly, every response:
- Write in clean Markdown.
- Use $...$ for ALL inline math: $f(x)$, $x \\to 0$, $\\frac{x^2-1}{x-1}$, $\\lim_{x \\to 1}$
- Use $$...$$ on its own line for display math: $$\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1$$
- NEVER use backticks for math or notation — backticks are only for exact code identifiers like variable names.
- Use **bold** for key terms.
- Use numbered or bullet lists when listing steps or multiple points.
- If you have a follow-up question, end your response with it on a new paragraph.`

export function buildYouAreHerePointer(page: CurrentDoubtPage) {
  const lastPageMarker = page.isLastPage ? ' · LAST PAGE OF TOPIC' : ''
  return `=== CURRENT POSITION ===
Course: ${page.courseTitle}
Primary topic: ${page.branchTitle} (${page.branchPosition} of ${page.branchTotal})
Subtopic: ${page.topicTitle} (${page.topicPosition} of ${page.topicTotal})
Current page: Page ${page.pageNumber} of ${page.totalPages}${page.pageFocus ? ` - "${page.pageFocus}"` : ''}${lastPageMarker}
Course page: ${page.globalPageNumber} of ${page.globalPageTotal}
========================`
}

function formatHistory(messages: DoubtHistoryMessage[]) {
  if (!messages.length) return 'No recent doubt history.'

  return messages
    .map((message) => {
      const where = message.topic_title
        ? ` [${message.topic_title}${message.page_number ? `, p${message.page_number}` : ''}${message.global_page_number ? `, course p${message.global_page_number}` : ''}]`
        : ''
      return `${message.role.toUpperCase()}${where}: ${message.content}`
    })
    .join('\n')
}

function formatRelevantPages(pages: RelevantPage[]) {
  if (!pages.length) return 'No relevant earlier pages found.'

  return pages
    .map((page) => `[${page.topic_title} - page ${page.page_number}]
${page.focus ? `Focus: ${page.focus}\n` : ''}${page.summary ? `Summary: ${page.summary}\n` : ''}${page.content}`)
    .join('\n\n---\n\n')
}

function formatRelevantDoubts(messages: RelevantDoubtMemory[]) {
  if (!messages.length) return 'No semantically relevant prior doubts found.'

  return messages
    .map((message) => {
      const where = message.topic_title
        ? ` [${message.topic_title}${message.page_number ? `, p${message.page_number}` : ''}]`
        : ''
      return `${message.role.toUpperCase()}${where}: ${message.content}`
    })
    .join('\n')
}

function formatRelevantSources(chunks: RelevantSourceChunk[]) {
  if (!chunks.length) return 'No source chunks are connected yet.'

  return chunks
    .map((chunk) => {
      const title = chunk.source_title ?? 'Course source'
      return `[${title}]
${chunk.content}`
    })
    .join('\n\n---\n\n')
}

export function buildDoubtPrompt({
  type,
  question,
  selectedContext,
  workspaceContext,
  currentPage,
  recentHistory,
  conceptMap,
  relevantPages = [],
  relevantDoubts = [],
  relevantSources = [],
}: {
  type: DoubtQuestionType
  question: string
  selectedContext?: string | null
  workspaceContext?: string | null
  currentPage: CurrentDoubtPage
  recentHistory: DoubtHistoryMessage[]
  conceptMap: string[]
  relevantPages?: RelevantPage[]
  relevantDoubts?: RelevantDoubtMemory[]
  relevantSources?: RelevantSourceChunk[]
}) {
  const pointer = buildYouAreHerePointer(currentPage)
  const historyBlock = `Recent doubt history:\n${formatHistory(recentHistory.slice(-6))}`
  const selectedContextBlock = selectedContext?.trim()
    ? `\nSELECTED PASSAGE THE STUDENT ATTACHED:\n${selectedContext.trim()}\n`
    : ''
  const workspaceContextBlock = workspaceContext?.trim()
    ? `\n${workspaceContext.trim()}\n`
    : ''

  // general_knowledge: minimal context — no retrieval data needed, no concept map.
  // The model answers from its own knowledge; injecting course memory is pure waste.
  if (type === 'general_knowledge') {
    return {
      system: `${DOUBT_SYSTEM_PROMPT}

${pointer}

${historyBlock}
${selectedContextBlock}
${workspaceContextBlock}

Answer from general knowledge, but keep it relevant to the current topic.
Do not invent course-specific claims not supported by general knowledge.`,
      user: `Student question: ${question}

Respond in Markdown following the formatting rules above. Do not wrap in JSON.`,
    }
  }

  // current_page: page content is the authority. No cross-topic retrieval needed.
  if (type === 'current_page') {
    const conceptLine = conceptMap.length
      ? `Course concept map: ${conceptMap.slice(0, 60).join(', ')}`
      : ''
    return {
      system: `${DOUBT_SYSTEM_PROMPT}

${pointer}
${conceptLine ? `\n${conceptLine}\n` : ''}
${historyBlock}
${selectedContextBlock}
${workspaceContextBlock}

CURRENT PAGE CONTENT:
${currentPage.content}`,
      user: `Student question: ${question}

Respond in Markdown grounded in the page content above. Do not wrap in JSON.`,
    }
  }

  // course_specific: full retrieval context — concept map, prior doubts, sources, cross-topic pages.
  const conceptLine = conceptMap.length
    ? `Course concept map: ${conceptMap.slice(0, 120).join(', ')}`
    : ''
  return {
    system: `${DOUBT_SYSTEM_PROMPT}

${pointer}
${conceptLine ? `\n${conceptLine}\n` : ''}
${historyBlock}
${selectedContextBlock}
${workspaceContextBlock}

Semantically relevant prior doubts:
${formatRelevantDoubts(relevantDoubts)}

Relevant source material:
${formatRelevantSources(relevantSources)}

CURRENT PAGE CONTENT:
${currentPage.content}

RELEVANT CONTENT FROM EARLIER IN THIS COURSE:
${formatRelevantPages(relevantPages)}

Use the current page, earlier course content, prior doubts, and source material above when connecting concepts.
Do not mention retrieval mechanics unless the student asks. Reference what was actually taught.`,
    user: `Student question: ${question}

Respond in Markdown grounded in the course content above. Do not wrap in JSON.`,
  }
}
