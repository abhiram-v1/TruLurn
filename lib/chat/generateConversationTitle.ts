import { generateAI } from '@/lib/ai'

const SYSTEM_PROMPT = `You name chat conversations between a student and their AI course tutor.
Given the student's first question and the tutor's answer, write a short title
that would help the student recognize this conversation later in a list of
saved chats — the way ChatGPT or Claude titles a new conversation.

Rules:
- 3 to 6 words.
- No quotation marks, no trailing period, no emoji.
- Name the topic or question, not "Chat" or "Conversation".
- Return ONLY the title text, nothing else.`

function fallbackTitle(question: string) {
  const clean = question.replace(/\s+/g, ' ').trim()
  return clean.length > 60 ? `${clean.slice(0, 57)}...` : clean
}

function sanitizeTitle(raw: string, question: string) {
  const cleaned = raw
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/[.\s]+$/, '')
    .replace(/\s+/g, ' ')

  if (!cleaned || cleaned.length > 80) return fallbackTitle(question)
  return cleaned
}

/**
 * Titles a saved chat thread from its first exchange, mirroring how ChatGPT/
 * Claude auto-name new conversations. Falls back to a plain truncation of
 * the question if the model call fails — a thread should never end up
 * untitled.
 */
export async function generateConversationTitle(question: string, answer: string): Promise<string> {
  try {
    const raw = await generateAI({
      feature: 'chat_title',
      system: SYSTEM_PROMPT,
      user: [
        `Student's question:\n${question.slice(0, 500)}`,
        `Tutor's answer:\n${(answer || '(no answer yet)').slice(0, 500)}`,
      ].join('\n\n'),
      purpose: 'agent',
      reasoningEffort: 'minimal',
      responseMimeType: 'text/plain',
    })
    return sanitizeTitle(raw, question)
  } catch (error) {
    console.warn('[chat] Failed to generate conversation title.', error)
    return fallbackTitle(question)
  }
}
