// Graph Manager: persists interaction-derived confidence scores, review states,
// edge scores, and an audit trail. Runs async — never blocks user-facing paths.

import crypto from 'crypto'
import type { Db } from 'mongodb'
import type { GraphElementReviewState } from './types'
import type { InteractionAnalysisResult } from './interactionAnalyzer'

// ── Score weights for composite calculation ────────────────────────────────

const WEIGHTS = {
  confidence: 0.30,
  recency:    0.20,
  frequency:  0.20,
  validation: 0.20,
  importance: 0.10,
}

function compositeScore(scores: {
  confidence: number
  recency: number
  frequency: number
  validation: number
  importance: number
}): number {
  return Math.round(
    scores.confidence * WEIGHTS.confidence +
    scores.recency    * WEIGHTS.recency    +
    scores.frequency  * WEIGHTS.frequency  +
    scores.validation * WEIGHTS.validation +
    scores.importance * WEIGHTS.importance,
  )
}

// ── Derive review state from composite confidence ──────────────────────────

export function reviewStateFromConfidence(confidence: number): GraphElementReviewState {
  if (confidence >= 90) return 'verified'
  if (confidence >= 72) return 'confirmed'
  if (confidence >= 50) return 'observed'
  if (confidence >= 30) return 'inferred'
  return 'proposed'
}

// ── Node metadata update ───────────────────────────────────────────────────

async function updateNodeMeta(
  db: Db,
  {
    userId,
    courseId,
    topicId,
    incomingConfidence,
    source,
    interactionId,
    now,
  }: {
    userId: string
    courseId: string
    topicId: string
    incomingConfidence: number
    source: string
    interactionId: string
    now: Date
  },
) {
  const col = db.collection('graphNodeMeta')
  const existing = await col.findOne({ user_id: userId, course_id: courseId, topic_id: topicId })

  const prevConf = Number(existing?.confidence_score ?? 50)
  const prevObs  = Number(existing?.observation_count ?? 0)

  // Bayesian-inspired update: new observations shift confidence toward evidence
  const newConf = Math.min(100, Math.round(prevConf * 0.70 + incomingConfidence * 0.30))
  const newObs  = prevObs + 1
  const reviewState = reviewStateFromConfidence(newConf)

  const changeEntry = {
    at: now.toISOString(),
    source,
    prev_confidence: prevConf,
    new_confidence: newConf,
    review_state: reviewState,
    interaction_id: interactionId,
  }

  await col.updateOne(
    { user_id: userId, course_id: courseId, topic_id: topicId },
    {
      $set: {
        confidence_score: newConf,
        review_state: reviewState,
        observation_count: newObs,
        last_source: source,
        last_interaction_id: interactionId,
        updated_at: now,
      },
      $push: {
        change_log: { $each: [changeEntry], $slice: -50 },
      } as any,
      $setOnInsert: {
        _id: crypto.randomUUID() as any,
        user_id: userId,
        course_id: courseId,
        topic_id: topicId,
        created_at: now,
      },
    },
    { upsert: true },
  )
}

// ── Edge score update ──────────────────────────────────────────────────────

async function updateEdgeScore(
  db: Db,
  {
    userId,
    courseId,
    fromLabel,
    toLabel,
    relationshipType,
    incomingConfidence,
    note,
    source,
    interactionId,
    now,
  }: {
    userId: string
    courseId: string
    fromLabel: string
    toLabel: string
    relationshipType: string
    incomingConfidence: number
    note?: string
    source: string
    interactionId: string
    now: Date
  },
) {
  const col = db.collection('graphEdgeScores')
  const key = {
    user_id: userId,
    course_id: courseId,
    from_label: fromLabel.slice(0, 120),
    to_label: toLabel.slice(0, 120),
  }
  const existing = await col.findOne(key)

  const prevConf = Number(existing?.confidence ?? 50)
  const prevFreq = Number(existing?.frequency ?? 0)
  const prevValid = Number(existing?.validation ?? 50)
  const prevImportance = Number(existing?.importance ?? 50)

  const newConf = Math.min(100, Math.round(prevConf * 0.65 + incomingConfidence * 0.35))
  const newFreq = Math.min(100, prevFreq + 4)         // each observation boosts frequency
  const newRecency = 100                               // just observed → fully fresh
  const newValid = Math.min(100, Math.max(0, Math.round(
    prevValid + (incomingConfidence > 60 ? 3 : -2),   // corroborating vs contradicting
  )))
  const newImportance = prevImportance                 // importance only changes via explicit signals

  const composite = compositeScore({
    confidence: newConf,
    recency: newRecency,
    frequency: newFreq,
    validation: newValid,
    importance: newImportance,
  })
  const reviewState = reviewStateFromConfidence(composite)

  const changeEntry = {
    at: now.toISOString(),
    source,
    prev_composite: Number(existing?.composite ?? 50),
    new_composite: composite,
    review_state: reviewState,
  }

  await col.updateOne(
    key,
    {
      $set: {
        confidence: newConf,
        recency: newRecency,
        frequency: newFreq,
        validation: newValid,
        importance: newImportance,
        composite,
        review_state: reviewState,
        relationship_type: relationshipType,
        ...(note ? { note } : {}),
        source,
        last_interaction_id: interactionId,
        updated_at: now,
      },
      $push: {
        change_log: { $each: [changeEntry], $slice: -30 },
      } as any,
      $setOnInsert: {
        _id: crypto.randomUUID() as any,
        ...key,
        created_at: now,
      },
    },
    { upsert: true },
  )
}

// ── Main entry point ───────────────────────────────────────────────────────

export async function updateGraphFromInteraction(params: {
  db: Db
  userId: string
  courseId: string
  topicId: string
  analysis: InteractionAnalysisResult
  interactionId?: string
}): Promise<void> {
  const { db, userId, courseId, topicId, analysis, interactionId } = params
  if (!analysis.is_update_graph) return

  const now = new Date()
  const logId = interactionId ?? crypto.randomUUID()

  // Node metadata updates
  for (const entity of analysis.entities) {
    await updateNodeMeta(db, {
      userId,
      courseId,
      topicId: entity.topicId ?? topicId,
      incomingConfidence: entity.confidence,
      source: analysis.source,
      interactionId: logId,
      now,
    })
  }

  // Edge score updates
  for (const rel of analysis.relationships) {
    await updateEdgeScore(db, {
      userId,
      courseId,
      fromLabel: rel.fromLabel,
      toLabel: rel.toLabel,
      relationshipType: rel.relationshipType,
      incomingConfidence: rel.confidence,
      note: rel.note,
      source: analysis.source,
      interactionId: logId,
      now,
    })
  }

  // Audit trail
  await db.collection('graphInteractionLog').insertOne({
    _id: logId as any,
    user_id: userId,
    course_id: courseId,
    topic_id: topicId,
    source: analysis.source,
    entity_count: analysis.entities.length,
    relationship_count: analysis.relationships.length,
    created_at: now,
  })
}
