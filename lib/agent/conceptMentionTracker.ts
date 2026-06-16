import crypto from 'crypto'
import type { Db } from 'mongodb'

// Records provisional concept-knowledge evidence when the learner discusses
// in-scope concepts through the chat agent. Uses the lowest-trust evidence
// kind (chat_discussion) so a single conversation doesn't claim understanding.
// The reconciliation loop in syncLearnerMemoryV2 integrates these events into
// learnerConceptStates on the next sync pass.
export async function recordConceptDiscussion(
  db: Db,
  userId: string,
  courseId: string,
  topicId: string,
  concepts: string[],
): Promise<void> {
  if (!concepts.length) return

  await db.collection('learningEvents').insertMany(
    concepts.map((concept) => ({
      _id: crypto.randomUUID() as any,
      course_id: courseId,
      topic_id: topicId,
      user_id: userId,
      event_type: 'concept_discussed_in_chat',
      concept,
      // Lowest-trust evidence — one chat mention barely moves the stage estimate.
      // Multiple discussions of the same concept compound and eventually lift stage.
      evidence_kind: 'chat_discussion',
      authority: 'single_inference',
      created_at: new Date(),
    })),
  )

  // Invalidate the sync gate so the next getLearnerMemorySnapshot reconciles these
  await db
    .collection('learnerMemorySyncStates')
    .deleteOne({ user_id: userId, course_id: courseId })
    .catch(() => {})
}

// Out-of-scope questions should not write to the canonical concept knowledge graph.
// General knowledge questions explore outside the course boundary.
export function isOutOfScopeQuestion(questionType: string): boolean {
  return questionType === 'general_knowledge'
}
