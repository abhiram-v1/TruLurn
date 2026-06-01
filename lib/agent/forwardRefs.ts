import type { Db } from 'mongodb'

const TAG = 'FORWARD_REF:'

// ── Extraction ────────────────────────────────────────────────────────────────

export function extractForwardRef(response: string): {
  cleanResponse: string
  ref: { concept: string; targetTopic: string } | null
} {
  const lines = response.split('\n')
  const tagLine = lines.find((l) => l.trim().startsWith(TAG))

  if (!tagLine) return { cleanResponse: response, ref: null }

  const cleanResponse = lines
    .filter((l) => !l.trim().startsWith(TAG))
    .join('\n')
    .trim()

  const tagContent = tagLine.replace(TAG, '').trim()
  const [concept, targetTopic] = tagContent.split('|').map((s) => s.trim())

  if (!concept || !targetTopic) return { cleanResponse, ref: null }

  return { cleanResponse, ref: { concept, targetTopic } }
}

// ── Storage ───────────────────────────────────────────────────────────────────

export async function storeForwardRef(
  db: Db,
  userId: string,
  courseId: string,
  question: string,
  concept: string,
  targetTopicTitle: string,
  askedAt: { topicId: string; pageNumber: number; topicTitle: string },
) {
  const escaped = targetTopicTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const targetTopic = await db.collection('topics').findOne({
    course_id: courseId,
    title: { $regex: new RegExp(escaped, 'i') },
  })

  if (!targetTopic) return

  await db.collection('agent_forward_refs').insertOne({
    user_id: userId,
    course_id: courseId,
    question,
    concept,
    asked_at: askedAt,
    target_topic_id: String(targetTopic._id),
    surfaced: false,
    created_at: new Date(),
  })
}

// ── Surfacing ─────────────────────────────────────────────────────────────────

export async function getForwardRefsForTopic(
  db: Db,
  userId: string,
  topicId: string,
): Promise<any[]> {
  return db.collection('agent_forward_refs')
    .find({ user_id: userId, target_topic_id: topicId, surfaced: false })
    .toArray()
}

async function markSurfaced(db: Db, refIds: string[]) {
  if (!refIds.length) return
  await db.collection('agent_forward_refs').updateMany(
    { _id: { $in: refIds as any[] } },
    { $set: { surfaced: true } },
  )
}

// Returns an instruction block to inject into page generation prompts when the
// student previously asked about this topic's concepts while studying earlier material.
export async function getForwardRefBlock(
  db: Db,
  userId: string,
  topicId: string,
): Promise<string> {
  const refs = await getForwardRefsForTopic(db, userId, topicId)
  if (!refs.length) return ''

  await markSurfaced(db, refs.map((r) => String(r._id)))

  const refList = refs
    .map((r) => `  - "${r.question}" (asked while studying ${r.asked_at?.topicTitle ?? 'an earlier topic'})`)
    .join('\n')

  return `STUDENT PRIOR CURIOSITY:
The student asked about concepts in this topic before reaching it:
${refList}

If it reads naturally, acknowledge this connection in your explanation.
Do not say "I remember you asked" — weave it in organically.
Only include if it fits without forcing it.`.trim()
}
