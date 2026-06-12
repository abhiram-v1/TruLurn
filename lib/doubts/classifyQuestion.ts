import { generateAI, parseAIJson } from '@/lib/ai'

export type DoubtQuestionType =
  | 'general_knowledge'
  | 'current_page'
  | 'course_specific'

const CLASSIFY_SYSTEM = `You classify a student's question to determine what context is needed to answer it.

Categories:
- "current_page": The question is about content on the current lesson page — asks about "this", "here", "above", or something specific to the wording, examples, or terms visible on the page the student is reading right now. Also use this when the question is directly about the topic being taught on this page and can be answered from the page content alone.
- "course_specific": The question references something taught EARLIER in this course, asks how something connects to a previous topic, or needs context from the course history beyond the current page. Examples: "earlier you said...", "how does this connect to what we covered before", "is this the same as X from before?"
- "general_knowledge": The question is purely about a broad concept that has nothing to do with this specific course's content or sequence — answerable entirely from general knowledge without any course context.

Decision rules:
- When unsure between "current_page" and "course_specific", prefer "current_page".
- When unsure between "current_page" and "general_knowledge", prefer "current_page".
- Only use "general_knowledge" when the question is clearly not about the current topic at all.
- Only use "course_specific" when the question explicitly needs something from earlier in the course.`

export async function classifyQuestion(
  question: string,
  currentPageContent: string,
  conceptMap: string[],
): Promise<DoubtQuestionType> {
  try {
    const response = await generateAI({
      feature: 'doubt_classification',
      system: CLASSIFY_SYSTEM,
      user: `Current page content (excerpt):
${currentPageContent.slice(0, 1000)}

Previously covered course concepts:
${conceptMap.slice(0, 60).join(', ') || 'None yet'}

Student question:
${question}

Return JSON:
{
  "type": "current_page | course_specific | general_knowledge",
  "reason": "one sentence"
}`,
      purpose: 'agent',
      responseMimeType: 'application/json',
    })

    const parsed = parseAIJson<{ type?: DoubtQuestionType }>(response)

    if (
      parsed.type === 'general_knowledge' ||
      parsed.type === 'current_page' ||
      parsed.type === 'course_specific'
    ) {
      return parsed.type
    }
  } catch {
    // fall through to safe default
  }

  return 'current_page'
}
