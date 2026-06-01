import { generateWithGemini } from '@/lib/ai/gemini/client'
import { parseGeminiJson } from '@/lib/ai/gemini/json'

export type DoubtQuestionType =
  | 'general_knowledge'
  | 'current_page'
  | 'course_specific'

const COURSE_REF_SIGNALS = [
  'we covered',
  'you said',
  'earlier',
  'before',
  'remember when',
  'we learned',
  'from before',
  'what we did',
  'last time',
  'previously',
  'you mentioned',
  'we talked about',
  'we discussed',
  'back when',
  'in the beginning',
  'at the start',
]

const GENERAL_SIGNALS = [
  'what is',
  'what are',
  'define',
  'explain what',
  'how does',
  'why does',
  'what is the difference',
  'when should i use',
  'what happens when',
  'why is',
  'how do you',
  'what does it mean when',
]

export function heuristicClassify(
  question: string,
  currentPageContent: string,
  conceptMap: string[],
): DoubtQuestionType | 'ambiguous' {
  const q = question.toLowerCase()
  const page = currentPageContent.toLowerCase()

  if (COURSE_REF_SIGNALS.some((signal) => q.includes(signal))) {
    return 'course_specific'
  }

  const mentionsPastConcept = conceptMap.some((concept) => {
    const c = concept.toLowerCase()
    return c.length > 2 && q.includes(c) && !page.includes(c)
  })

  if (mentionsPastConcept) {
    return 'course_specific'
  }

  const mentionsPageContent =
    q.includes('this page') ||
    q.includes('this section') ||
    q.includes('above') ||
    q.includes('here') ||
    q.includes('paragraph') ||
    q.includes('example above') ||
    q.includes('this formula') ||
    q.includes('this equation') ||
    q.includes('selected part') ||
    q.includes('selected text')

  if (mentionsPageContent) {
    return 'current_page'
  }

  const isGeneralPattern = GENERAL_SIGNALS.some((signal) => q.startsWith(signal))
  if (isGeneralPattern && !mentionsPastConcept) {
    return 'general_knowledge'
  }

  return 'ambiguous'
}

export async function classifyQuestion(
  question: string,
  currentPageContent: string,
  conceptMap: string[],
): Promise<DoubtQuestionType> {
  const heuristicResult = heuristicClassify(question, currentPageContent, conceptMap)

  if (heuristicResult !== 'ambiguous') {
    return heuristicResult
  }

  const response = await generateWithGemini({
    model: process.env.GEMINI_CLASSIFIER_MODEL ?? process.env.GEMINI_MODEL,
    purpose: 'agent',
    system: `You classify student questions for an educational product.
Return JSON only.

Categories:
- general_knowledge: answerable from general model knowledge without course memory.
- current_page: answerable from the current page content.
- course_specific: asks about something taught earlier in this course, compares to earlier material, or needs course memory.`,
    user: `Current page excerpt:
${currentPageContent.slice(0, 900)}

Known course concepts:
${conceptMap.slice(0, 80).join(', ') || 'None yet'}

Student question:
${question}

Return:
{
  "type": "general_knowledge | current_page | course_specific"
}`,
  })

  const parsed = parseGeminiJson<{ type?: DoubtQuestionType }>(response)

  if (
    parsed.type === 'general_knowledge' ||
    parsed.type === 'current_page' ||
    parsed.type === 'course_specific'
  ) {
    return parsed.type
  }

  return 'current_page'
}
