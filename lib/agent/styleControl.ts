import crypto from 'crypto'
import type { Db } from 'mongodb'
import { generateWithGemini } from '@/lib/ai/gemini/client'
import { parseGeminiJson } from '@/lib/ai/gemini/json'

// ── Agent style control ───────────────────────────────────────────────────────
//
// Lets the in-app agent ACT on teaching-style feedback instead of just replying.
// When the student tells the tutor something like "stop assuming I know the key
// terms — treat me as a beginner", the agent:
//   1. detects the request (cheap keyword gate → small model confirmation),
//   2. persists it on the course (knowledge_level and/or a durable directive),
//   3. acknowledges it in the answer.
// Every future lesson page reads these course fields at generation time, so the
// adjustment applies automatically without the student touching settings.

export type StyleAdjustment = {
  knowledgeLevel: 'beginner' | 'intermediate' | 'expert' | null
  directive: string
}

// Cheap gate — only call the model when the message plausibly talks about
// teaching style. Keeps the doubt pipeline fast for normal questions.
const STYLE_HINT =
  /\b(treat me|assume|assumes|assuming|beginner|newbie|novice|expert|advanced|too basic|too simple|too easy|too hard|too difficult|too advanced|jargon|terminology|key terms|technical terms|simpler|simplify|dumb(?:\s+it)?\s+down|more examples|fewer examples|less math|more math|less theory|more theory|explain like|eli5|teaching style|lesson style|page style|tone|slow down|too fast|over my head)\b/i

export function mightBeStyleRequest(question: string): boolean {
  return STYLE_HINT.test(question)
}

/**
 * Confirm + extract a style adjustment from a student message. Returns null
 * unless the message is genuinely asking to change HOW lessons teach (not just
 * asking a content question that happens to mention "examples" or "basic").
 */
export async function detectStyleAdjustment(question: string): Promise<StyleAdjustment | null> {
  if (!mightBeStyleRequest(question)) return null

  try {
    const text = await generateWithGemini({
      system: `You decide whether a student message is a request to change the TEACHING STYLE of their course lessons (vs an ordinary content question). Return only JSON.`,
      user: `Student message:
"""${question.slice(0, 800)}"""

Is this a request to change how future lessons are written (difficulty level, assumed knowledge, amount of jargon, examples, math/theory balance, tone, pacing)?

Return exactly:
{
  "is_style_request": true|false,
  "knowledge_level": "beginner|intermediate|expert|null",
  "directive": "one imperative sentence for the lesson writer capturing the request, or empty string"
}

Rules:
- is_style_request is true ONLY for explicit requests about how lessons teach. A content question ("what is a basic example of X?") is false.
- knowledge_level: set only when the student clearly asks to be treated at that level; otherwise null.
- directive: concrete and writer-ready, e.g. "Do not assume prior knowledge of key terms — define every technical term when first used." Empty when is_style_request is false.`,
      purpose: 'agent',
      responseMimeType: 'application/json',
    })

    const parsed = parseGeminiJson<{
      is_style_request?: boolean
      knowledge_level?: string | null
      directive?: string
    }>(text)

    if (!parsed?.is_style_request) return null
    const directive = String(parsed.directive ?? '').trim()
    if (!directive) return null

    const level = parsed.knowledge_level
    return {
      knowledgeLevel: level === 'beginner' || level === 'intermediate' || level === 'expert' ? level : null,
      directive: directive.slice(0, 300),
    }
  } catch (error) {
    console.warn('Style adjustment detection failed.', error)
    return null
  }
}

const MAX_DIRECTIVES = 5

/**
 * Persist the adjustment on the course so every future page generation picks it
 * up (generateTopicPage reads knowledge_level + style_directives fresh each call).
 * Also logs a learning event so the change is auditable.
 */
export async function applyStyleAdjustment({
  db,
  courseId,
  userId,
  topicId,
  adjustment,
}: {
  db: Db
  courseId: string
  userId: string
  topicId: string
  adjustment: StyleAdjustment
}): Promise<void> {
  const course = await db.collection('courses').findOne(
    { _id: courseId as any, user_id: userId },
    { projection: { style_directives: 1, knowledge_level: 1 } },
  )
  if (!course) return

  const existing: string[] = Array.isArray(course.style_directives) ? course.style_directives : []
  // Skip near-duplicate directives (same lowercased text already stored)
  const isDuplicate = existing.some(
    (d) => String(d).toLowerCase().trim() === adjustment.directive.toLowerCase().trim(),
  )
  const directives = isDuplicate ? existing : [...existing, adjustment.directive].slice(-MAX_DIRECTIVES)

  const set: Record<string, unknown> = {
    style_directives: directives,
    updated_at: new Date(),
  }
  if (adjustment.knowledgeLevel) set.knowledge_level = adjustment.knowledgeLevel

  await db.collection('courses').updateOne({ _id: courseId as any, user_id: userId }, { $set: set })

  await db.collection('learningEvents').insertOne({
    _id: crypto.randomUUID() as any,
    course_id: courseId,
    topic_id: topicId,
    user_id: userId,
    event_type: 'style_adjustment_applied',
    directive: adjustment.directive,
    knowledge_level: adjustment.knowledgeLevel,
    created_at: new Date(),
  })
}
