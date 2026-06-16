import crypto from 'crypto'
import type { Db } from 'mongodb'
import {
  classifyGap,
  shouldCircuitBreak,
  nextApproach,
  type RegenerationAttempt,
} from './adaptiveSignals'

// Reads fresh assessment state for a topic and flags it for review if gaps are found.
// Must be called after syncLearnerMemoryV2 so skill/concept states are up to date.
export async function applyAdaptiveFeedback(
  db: Db,
  courseId: string,
  topicId: string,
  userId: string,
): Promise<{ gapFound: boolean; action: string; reason: string }> {
  const [skillStates, misconceptionStates, conceptStates, topic] = await Promise.all([
    db.collection('learnerSkillStates')
      .find({ user_id: userId, course_id: courseId, topic_id: topicId })
      .toArray(),
    db.collection('learnerMisconceptionStates')
      .find({ user_id: userId, course_id: courseId, topic_id: topicId })
      .toArray(),
    db.collection('learnerConceptStates')
      .find({ user_id: userId, course_id: courseId })
      .toArray(),
    db.collection('topics').findOne(
      { _id: topicId as any, course_id: courseId },
      { projection: { needs_review: 1, regeneration_attempts: 1 } },
    ),
  ])

  if (!topic) return { gapFound: false, action: 'continue', reason: 'Topic not found.' }

  const existingAttempts: RegenerationAttempt[] = Array.isArray(topic.regeneration_attempts)
    ? topic.regeneration_attempts
    : []

  const gap = classifyGap(
    skillStates as any[],
    misconceptionStates as any[],
    conceptStates as any[],
  )

  if (!gap.hasGap) {
    // Learner improved — clear any outstanding review flag and record the outcome
    if (topic.needs_review) {
      await Promise.all([
        db.collection('topics').updateOne(
          { _id: topicId as any, course_id: courseId },
          {
            $set: {
              needs_review: false,
              review_cleared_at: new Date(),
              review_outcome: 'improved',
              regeneration_attempts: [],
              updated_at: new Date(),
            },
            $unset: { review_approach: '', adaptive_reason: '', adaptive_gap_type: '' },
          },
        ),
        db.collection('learningEvents').insertOne({
          _id: crypto.randomUUID() as any,
          course_id: courseId,
          topic_id: topicId,
          user_id: userId,
          event_type: 'adaptive_intervention_succeeded',
          prior_attempts: existingAttempts.length,
          action: gap.action,
          created_at: new Date(),
        }),
      ])
    }
    return { gapFound: false, action: gap.action, reason: gap.reason }
  }

  // Circuit break: too many failed regeneration loops — stop and switch strategy
  if (shouldCircuitBreak(existingAttempts)) {
    await Promise.all([
      db.collection('topics').updateOne(
        { _id: topicId as any, course_id: courseId },
        {
          $set: {
            needs_review: false,
            review_outcome: 'circuit_break',
            regeneration_circuit_break_at: new Date(),
            updated_at: new Date(),
          },
        },
      ),
      db.collection('learningEvents').insertOne({
        _id: crypto.randomUUID() as any,
        course_id: courseId,
        topic_id: topicId,
        user_id: userId,
        event_type: 'adaptive_loop_circuit_break',
        attempts: existingAttempts.length,
        gap_type: gap.gapType,
        reason: 'Maximum regeneration attempts reached without measurable improvement.',
        created_at: new Date(),
      }),
    ])
    return {
      gapFound: true,
      action: 'schedule_recall',
      reason: 'Circuit break: recommending spaced repetition instead of another regeneration.',
    }
  }

  // Rotate to the next approach when the previous one did not help
  const action = existingAttempts.length > 0 ? nextApproach(existingAttempts) : gap.action

  await Promise.all([
    db.collection('topics').updateOne(
      { _id: topicId as any, course_id: courseId },
      {
        $set: {
          needs_review: true,
          review_approach: action,
          adaptive_reason: gap.reason,
          adaptive_gap_type: gap.gapType,
          adaptive_affected_concepts: gap.affectedConcepts,
          adaptive_misconceptions: gap.misconceptions,
          updated_at: new Date(),
        },
      },
    ),
    db.collection('learningEvents').insertOne({
      _id: crypto.randomUUID() as any,
      course_id: courseId,
      topic_id: topicId,
      user_id: userId,
      event_type: 'adaptive_review_flagged',
      gap_type: gap.gapType,
      action,
      reason: gap.reason,
      confidence: gap.confidence,
      affected_concepts: gap.affectedConcepts,
      misconceptions: gap.misconceptions,
      prior_attempts: existingAttempts.length,
      created_at: new Date(),
    }),
  ])

  return { gapFound: true, action, reason: gap.reason }
}

// Called in executeAction when the student manually requests regeneration.
// Tracks the attempt and returns whether to circuit break.
export async function recordRegenerationAttempt(
  db: Db,
  courseId: string,
  topicId: string,
  approach: string,
): Promise<{ shouldStop: boolean; nextApproachSuggestion: string | null }> {
  const topic = await db.collection('topics').findOne(
    { _id: topicId as any, course_id: courseId },
    { projection: { regeneration_attempts: 1 } },
  )

  const existing: RegenerationAttempt[] = Array.isArray(topic?.regeneration_attempts)
    ? topic.regeneration_attempts
    : []

  const updated: RegenerationAttempt[] = [
    ...existing,
    { approach, at: new Date().toISOString(), succeeded: null },
  ]

  await db.collection('topics').updateOne(
    { _id: topicId as any, course_id: courseId },
    { $set: { regeneration_attempts: updated, updated_at: new Date() } },
  )

  const stop = shouldCircuitBreak(updated)
  return {
    shouldStop: stop,
    nextApproachSuggestion: stop ? null : (nextApproach(updated) as string),
  }
}

// Scans all assessed topics in the course for gaps and flags any that need review.
// Run after syncLearnerMemoryV2 so states are fresh. Fire-and-forget safe.
export async function flagCourseTopicsForReview(
  db: Db,
  courseId: string,
  userId: string,
): Promise<number> {
  const [weakTopicIds, misconceptionTopicIds] = await Promise.all([
    db.collection('learnerSkillStates')
      .distinct('topic_id', {
        user_id: userId,
        course_id: courseId,
        effective_mastery: { $lt: 0.4 },
      }),
    db.collection('learnerMisconceptionStates')
      .distinct('topic_id', { user_id: userId, course_id: courseId }),
  ])

  const topicIds = [...new Set([...weakTopicIds, ...misconceptionTopicIds].map(String))]
  if (!topicIds.length) return 0

  let flagged = 0
  for (const topicId of topicIds) {
    const result = await applyAdaptiveFeedback(db, courseId, topicId, userId).catch((err) => {
      console.warn(`[adaptive] Gap analysis failed for topic ${topicId}:`, err)
      return null
    })
    if (result?.gapFound) flagged++
  }
  return flagged
}
