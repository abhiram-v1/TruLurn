import crypto from 'crypto'
import type { Db } from 'mongodb'
import type {
  LearnerMemoryAuthority,
  LearnerMemoryKind,
  LearnerMemoryRecord,
  LearnerMemoryStatus,
  LearnerConceptState,
  LearnerMisconceptionState,
  LearnerSkillState,
} from '@/lib/memory/types'
import {
  deriveConceptKnowledgeEstimate,
  normalizeConceptKey,
  type ConceptEvidence,
  type ConceptEvidenceKind,
  type ConceptKnowledgeStage,
} from '@/lib/personalization/conceptKnowledge'

const MEMORY_SCHEMA_VERSION = 'learner-memory-v2'
const MEMORY_SYNC_TTL_MS = 10 * 60 * 1000
const MIN_EFFECTIVE_CONFIDENCE = 0.25

const AUTHORITY_RANK: Record<LearnerMemoryAuthority, number> = {
  explicit_user: 5,
  course_setting: 4,
  validated_assessment: 3,
  repeated_behavior: 2,
  single_inference: 1,
}

type MemoryInput = {
  userId: string
  courseId?: string | null
  kind: LearnerMemoryKind
  key: string
  value: unknown
  confidence: number
  authority: LearnerMemoryAuthority
  source: string
  evidenceRefs?: string[]
  halfLifeDays?: number | null
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

export function normalizeMemoryValue(value: unknown): string {
  if (typeof value === 'string') return value.trim().toLowerCase().replace(/\s+/g, ' ')
  if (value == null) return ''
  return JSON.stringify(value, Object.keys(value as object).sort()).toLowerCase()
}

export function memoryEffectiveConfidence({
  confidence,
  authority,
  halfLifeDays,
  validFrom,
  now = new Date(),
}: {
  confidence: number
  authority: LearnerMemoryAuthority
  halfLifeDays?: number | null
  validFrom: Date
  now?: Date
}) {
  if (authority === 'explicit_user' || authority === 'course_setting' || !halfLifeDays) {
    return clamp(confidence)
  }
  const ageDays = Math.max(0, now.getTime() - validFrom.getTime()) / 86_400_000
  return clamp(confidence * Math.pow(0.5, ageDays / halfLifeDays))
}

export function effectiveSkillMastery({
  posteriorMastery,
  stabilityDays,
  lastAssessedAt,
  now = new Date(),
}: {
  posteriorMastery: number
  stabilityDays: number
  lastAssessedAt: Date | null
  now?: Date
}) {
  if (!lastAssessedAt) return 0.5
  const ageDays = Math.max(0, now.getTime() - lastAssessedAt.getTime()) / 86_400_000
  const retention = Math.exp(-ageDays / Math.max(1, stabilityDays))
  return clamp(0.5 + (posteriorMastery - 0.5) * retention)
}

function skillState(value: number, evidenceCount: number): LearnerSkillState['state'] {
  if (evidenceCount < 2) return 'unknown'
  if (value >= 0.8) return 'strong'
  if (value >= 0.62) return 'functional'
  return 'developing'
}

function memoryKeyFilter(input: Pick<MemoryInput, 'userId' | 'courseId' | 'kind' | 'key'>) {
  return {
    user_id: input.userId,
    course_id: input.courseId ?? null,
    kind: input.kind,
    key: input.key,
  }
}

export async function upsertLearnerMemory(db: Db, input: MemoryInput) {
  const collection = db.collection('learnerMemories')
  const now = new Date()
  const normalizedValue = normalizeMemoryValue(input.value)
  const latest = await collection.findOne(
    memoryKeyFilter(input),
    { sort: { updated_at: -1 } },
  )
  if (
    latest?.status === 'deleted'
    && latest.deleted_by_user === true
    && AUTHORITY_RANK[input.authority] < AUTHORITY_RANK.explicit_user
  ) {
    return { id: String(latest._id), status: 'deleted' as const, changed: false }
  }
  const active = await collection.findOne({
    ...memoryKeyFilter(input),
    status: 'active',
    valid_to: null,
  })

  if (active && String(active.normalized_value ?? '') === normalizedValue) {
    const evidenceRefs = [...new Set([
      ...((active.evidence_refs as string[] | undefined) ?? []),
      ...(input.evidenceRefs ?? []),
    ])].slice(-50)
    // Re-confirmation of the same value by a higher-authority source should
    // upgrade the authority (and stop decay when it becomes explicit/setting),
    // not just bump confidence. Otherwise a fact the user later states explicitly
    // keeps decaying as if it were still a single inference.
    const activeRank = AUTHORITY_RANK[String(active.authority) as LearnerMemoryAuthority] ?? 0
    const upgradeAuthority = AUTHORITY_RANK[input.authority] > activeRank
    const authorityFields = upgradeAuthority
      ? {
          authority: input.authority,
          source: input.source,
          half_life_days: input.halfLifeDays ?? null,
        }
      : {}
    await collection.updateOne(
      { _id: active._id },
      {
        $set: {
          confidence: Math.max(Number(active.confidence ?? 0), clamp(input.confidence)),
          evidence_refs: evidenceRefs,
          ...authorityFields,
          updated_at: now,
        },
      },
    )
    return { id: String(active._id), status: 'active' as const, changed: upgradeAuthority }
  }

  const incomingRank = AUTHORITY_RANK[input.authority]
  const activeRank = active
    ? AUTHORITY_RANK[String(active.authority) as LearnerMemoryAuthority] ?? 0
    : 0
  const canPromote = !active || incomingRank >= activeRank
  const status: LearnerMemoryStatus = canPromote ? 'active' : 'contradicted'
  const id = crypto.randomUUID()

  if (active && canPromote) {
    await collection.updateOne(
      { _id: active._id },
      {
        $set: {
          status: incomingRank === activeRank ? 'contradicted' : 'superseded',
          valid_to: now,
          updated_at: now,
          superseded_by: id,
        },
      },
    )
  }

  await collection.insertOne({
    _id: id as any,
    user_id: input.userId,
    course_id: input.courseId ?? null,
    kind: input.kind,
    key: input.key,
    value: input.value,
    normalized_value: normalizedValue,
    confidence: clamp(input.confidence),
    authority: input.authority,
    source: input.source,
    evidence_refs: [...new Set(input.evidenceRefs ?? [])].slice(-50),
    status,
    valid_from: now,
    valid_to: canPromote ? null : now,
    half_life_days: input.halfLifeDays ?? null,
    sensitivity: 'standard',
    schema_version: MEMORY_SCHEMA_VERSION,
    created_at: now,
    updated_at: now,
  })

  return { id, status, changed: true }
}

async function upsertMemoryCandidate(db: Db, input: MemoryInput) {
  const collection = db.collection('learnerMemories')
  const normalizedValue = normalizeMemoryValue(input.value)
  const now = new Date()
  const latest = await collection.findOne(
    memoryKeyFilter(input),
    { sort: { updated_at: -1 } },
  )
  if (
    latest?.status === 'deleted'
    && latest.deleted_by_user === true
    && AUTHORITY_RANK[input.authority] < AUTHORITY_RANK.explicit_user
  ) {
    return String(latest._id)
  }
  const existing = await collection.findOne({
    ...memoryKeyFilter(input),
    normalized_value: normalizedValue,
    status: 'candidate',
  })
  if (existing) {
    await collection.updateOne(
      { _id: existing._id },
      {
        $set: {
          confidence: clamp(input.confidence),
          evidence_refs: [...new Set(input.evidenceRefs ?? [])].slice(-50),
          updated_at: now,
        },
      },
    )
    return String(existing._id)
  }
  const id = crypto.randomUUID()
  await collection.insertOne({
    _id: id as any,
    user_id: input.userId,
    course_id: input.courseId ?? null,
    kind: input.kind,
    key: input.key,
    value: input.value,
    normalized_value: normalizedValue,
    confidence: clamp(input.confidence),
    authority: input.authority,
    source: input.source,
    evidence_refs: [...new Set(input.evidenceRefs ?? [])].slice(-50),
    status: 'candidate',
    valid_from: now,
    valid_to: null,
    half_life_days: input.halfLifeDays ?? null,
    sensitivity: 'standard',
    schema_version: MEMORY_SCHEMA_VERSION,
    created_at: now,
    updated_at: now,
  })
  return id
}

export async function recordExplicitCourseMemories({
  db,
  userId,
  courseId,
  course,
}: {
  db: Db
  userId: string
  courseId: string
  course: any
}) {
  const writes: Promise<unknown>[] = []
  if (course.knowledge_level) {
    writes.push(upsertLearnerMemory(db, {
      userId,
      courseId,
      kind: 'preference',
      key: 'teaching.knowledge_level',
      value: String(course.knowledge_level),
      confidence: 1,
      authority: 'course_setting',
      source: 'course.knowledge_level',
    }))
  }
  if (course.source_coverage_preference) {
    writes.push(upsertLearnerMemory(db, {
      userId,
      courseId,
      kind: 'preference',
      key: 'teaching.source_coverage',
      value: String(course.source_coverage_preference),
      confidence: 1,
      authority: 'explicit_user',
      source: 'course.source_coverage_preference',
    }))
  }
  const learnerAudience = course.learner_audience ?? course.learner_persona
  if (learnerAudience?.label) {
    const audienceInput: MemoryInput = {
      userId,
      courseId,
      kind: 'profile',
      key: 'learner.audience',
      value: String(learnerAudience.label),
      confidence: learnerAudience.source === 'stated' ? 1 : 0.55,
      authority: learnerAudience.source === 'stated'
        ? 'explicit_user'
        : 'single_inference',
      source: `course.learner_audience.${learnerAudience.source ?? 'derived'}`,
      halfLifeDays: learnerAudience.source === 'stated' ? null : 120,
    }
    writes.push(learnerAudience.source === 'stated'
      ? upsertLearnerMemory(db, audienceInput)
      : upsertMemoryCandidate(db, audienceInput))
  }
  await Promise.all(writes)
}

async function reconcileBehavioralCandidates(db: Db, userId: string, courseId: string) {
  const feedback = await db.collection('lessonFeedback')
    .find({ user_id: userId, course_id: courseId })
    .sort({ updated_at: -1 })
    .limit(30)
    .project({ _id: 1, signal: 1 })
    .toArray()
  if (!feedback.length) return

  const counts = new Map<string, number>()
  for (const item of feedback) {
    const signal = String(item.signal ?? '')
    counts.set(signal, (counts.get(signal) ?? 0) + 1)
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const [dominant, dominantCount] = ranked[0] ?? ['', 0]
  const dominance = dominantCount / feedback.length
  if (dominant === 'got_it') return
  const input: MemoryInput = {
    userId,
    courseId,
    kind: 'observation',
    key: 'learning.comprehension_support',
    value: dominant === 'lost_me' ? 'needs_more_support' : 'ready_for_more_depth',
    confidence: clamp(0.5 + dominance * 0.35),
    authority: 'repeated_behavior',
    source: 'lessonFeedback',
    evidenceRefs: feedback.filter((item) => item.signal === dominant).map((item) => String(item._id)),
    halfLifeDays: 45,
  }
  if (dominantCount >= 3 && dominance >= 0.67) {
    await upsertLearnerMemory(db, input)
    await db.collection('learnerMemories').updateMany(
      {
        ...memoryKeyFilter(input),
        status: 'candidate',
      },
      {
        $set: {
          status: 'superseded',
          valid_to: new Date(),
          updated_at: new Date(),
        },
      },
    )
  } else {
    await upsertMemoryCandidate(db, input)
  }
}

type AssessmentEvidence = {
  id: string
  skillKey: string
  label: string
  topicId: string | null
  passed: boolean
  falseConfidence: boolean
  gap: string
  weight: number
  assessedAt: Date
}

function assessmentEvidence(turns: any[]): AssessmentEvidence[] {
  return turns.map((turn) => {
    const label = String(turn.concept ?? turn.roadmap_node_id ?? 'unknown concept').trim()
    const evaluation = turn.evaluation ?? {}
    return {
      id: String(turn._id),
      skillKey: normalizeMemoryValue(label).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      label,
      topicId: turn.topic_id ? String(turn.topic_id) : null,
      passed: Boolean(evaluation.passed),
      falseConfidence: Boolean(evaluation.false_confidence),
      gap: String(evaluation.gap ?? '').trim(),
      weight: clamp(1 + Number(turn.difficulty ?? 1) * 0.12, 1, 1.8),
      assessedAt: new Date(turn.evaluated_at ?? turn.updated_at ?? turn.created_at ?? 0),
    }
  }).filter((item) => item.skillKey && Number.isFinite(item.assessedAt.getTime()))
}

async function reconcileAssessmentState(db: Db, userId: string, courseId: string) {
  const turns = await db.collection('examTurns')
    .find({
      user_id: userId,
      course_id: courseId,
      status: 'evaluated',
      evaluation: { $exists: true },
    })
    .sort({ evaluated_at: 1, turn_index: 1 })
    .project({
      _id: 1,
      topic_id: 1,
      concept: 1,
      roadmap_node_id: 1,
      difficulty: 1,
      evaluation: 1,
      evaluated_at: 1,
      updated_at: 1,
      created_at: 1,
    })
    .toArray()
  const evidence = assessmentEvidence(turns)
  const bySkill = new Map<string, AssessmentEvidence[]>()
  for (const item of evidence) {
    const list = bySkill.get(item.skillKey) ?? []
    list.push(item)
    bySkill.set(item.skillKey, list)
  }

  const now = new Date()
  for (const [key, items] of bySkill) {
    let alpha = 1
    let beta = 1
    for (const item of items) {
      if (item.passed) alpha += item.weight
      else beta += item.weight + (item.falseConfidence ? 0.5 : 0)
    }
    const posteriorMastery = alpha / (alpha + beta)
    const stabilityDays = Math.min(180, 14 + items.length * 7 + Math.max(0, alpha - beta) * 3)
    const lastAssessedAt = items.at(-1)?.assessedAt ?? null
    const effectiveMastery = effectiveSkillMastery({
      posteriorMastery,
      stabilityDays,
      lastAssessedAt,
      now,
    })
    const successfulEvidence = items.filter((item) => item.passed).length
    const failedEvidence = items.length - successfulEvidence

    await db.collection('learnerSkillStates').updateOne(
      { user_id: userId, course_id: courseId, skill_key: key },
      {
        $set: {
          label: items.at(-1)?.label ?? key,
          topic_id: items.at(-1)?.topicId ?? null,
          evidence_count: items.length,
          successful_evidence: successfulEvidence,
          failed_evidence: failedEvidence,
          alpha,
          beta,
          posterior_mastery: posteriorMastery,
          effective_mastery: effectiveMastery,
          stability_days: stabilityDays,
          state: skillState(effectiveMastery, items.length),
          last_assessed_at: lastAssessedAt,
          evidence_refs: items.map((item) => item.id).slice(-50),
          schema_version: MEMORY_SCHEMA_VERSION,
          updated_at: now,
        },
        $setOnInsert: {
          _id: crypto.randomUUID() as any,
          user_id: userId,
          course_id: courseId,
          skill_key: key,
          created_at: now,
        },
      },
      { upsert: true },
    )

    const misconceptionEvidence = items.filter((item) => item.falseConfidence || (!item.passed && item.gap))
    const lastMisconception = misconceptionEvidence.at(-1)
    const correctionsAfter = lastMisconception
      ? items.filter((item) => item.assessedAt > lastMisconception.assessedAt && item.passed).length
      : 0
    const repeatedGap = misconceptionEvidence.filter((item) =>
      item.gap && normalizeMemoryValue(item.gap) === normalizeMemoryValue(lastMisconception?.gap)).length
    const shouldActivate = Boolean(lastMisconception)
      && correctionsAfter < 2
      && (Boolean(lastMisconception?.falseConfidence) || repeatedGap >= 2)
    const misconceptionKey = `${key}:primary`
    const existing = await db.collection('learnerMisconceptionStates').findOne({
      user_id: userId,
      course_id: courseId,
      misconception_key: misconceptionKey,
    })

    if (shouldActivate && lastMisconception) {
      const confidence = clamp(
        0.55
        + (lastMisconception.falseConfidence ? 0.25 : 0)
        + Math.min(0.15, Math.max(0, repeatedGap - 1) * 0.05),
      )
      await db.collection('learnerMisconceptionStates').updateOne(
        { user_id: userId, course_id: courseId, misconception_key: misconceptionKey },
        {
          $set: {
            skill_key: key,
            label: lastMisconception.label,
            topic_id: lastMisconception.topicId,
            description: lastMisconception.gap || `False confidence detected for ${lastMisconception.label}.`,
            confidence,
            evidence_count: misconceptionEvidence.length,
            correction_evidence_count: correctionsAfter,
            status: 'active',
            detected_at: existing?.status === 'active'
              ? existing.detected_at
              : lastMisconception.assessedAt,
            corrected_at: null,
            evidence_refs: misconceptionEvidence.map((item) => item.id).slice(-50),
            schema_version: MEMORY_SCHEMA_VERSION,
            updated_at: now,
          },
          $setOnInsert: {
            _id: crypto.randomUUID() as any,
            user_id: userId,
            course_id: courseId,
            misconception_key: misconceptionKey,
            created_at: now,
          },
        },
        { upsert: true },
      )
    } else if (existing?.status === 'active' && correctionsAfter >= 2) {
      await db.collection('learnerMisconceptionStates').updateOne(
        { _id: existing._id },
        {
          $set: {
            status: 'corrected',
            correction_evidence_count: correctionsAfter,
            corrected_at: now,
            updated_at: now,
          },
        },
      )
    }
  }
}

function evidenceDate(value: unknown) {
  const date = new Date(value as any)
  return Number.isFinite(date.getTime()) ? date : new Date(0)
}

async function reconcileConceptKnowledgeState(db: Db, userId: string, courseId: string) {
  const [studySessions, recallSessions, doubtMessages, feedback, examTurns, topics] = await Promise.all([
    db.collection('studySessions')
      .find({ user_id: userId, course_id: courseId })
      .sort({ updated_at: -1 })
      .limit(40)
      .project({ pages: 1 })
      .toArray(),
    db.collection('recallSessions')
      .find({ user_id: userId, course_id: courseId, status: 'completed' })
      .sort({ completed_at: -1 })
      .limit(30)
      .project({ items: 1, reviewed_item_ids: 1, completed_at: 1 })
      .toArray(),
    db.collection('doubtMessages')
      .find({ user_id: userId, course_id: courseId, role: 'user' })
      .sort({ created_at: -1 })
      .limit(120)
      .project({ topic_id: 1, content: 1, created_at: 1 })
      .toArray(),
    db.collection('lessonFeedback')
      .find({ user_id: userId, course_id: courseId })
      .sort({ updated_at: -1 })
      .limit(120)
      .project({ topic_id: 1, signal: 1, updated_at: 1, created_at: 1 })
      .toArray(),
    db.collection('examTurns')
      .find({
        user_id: userId,
        course_id: courseId,
        status: 'evaluated',
        evaluation: { $exists: true },
      })
      .sort({ evaluated_at: -1 })
      .limit(300)
      .project({
        topic_id: 1,
        concept: 1,
        roadmap_node_id: 1,
        type: 1,
        difficulty: 1,
        evaluation: 1,
        evaluated_at: 1,
      })
      .toArray(),
    db.collection('topics')
      .find({ course_id: courseId })
      .project({ title: 1, key_concepts: 1 })
      .toArray(),
  ])

  const topicMap = new Map(topics.map((topic) => [String(topic._id), topic]))
  const evidenceByConcept = new Map<string, {
    label: string
    topicId: string | null
    evidence: ConceptEvidence[]
  }>()
  const add = (
    labelValue: unknown,
    topicId: string | null,
    evidence: ConceptEvidence,
  ) => {
    const label = String(labelValue ?? '').trim()
    const key = normalizeConceptKey(label)
    if (!key) return
    const current = evidenceByConcept.get(key) ?? { label, topicId, evidence: [] }
    current.label = label || current.label
    current.topicId = topicId ?? current.topicId
    if (!current.evidence.some((item) => item.id === evidence.id)) current.evidence.push(evidence)
    evidenceByConcept.set(key, current)
  }

  for (const session of studySessions) {
    for (const page of (session.pages as any[]) ?? []) {
      const topicId = page.topic_id ? String(page.topic_id) : null
      const labels = Array.isArray(page.key_concepts) && page.key_concepts.length
        ? page.key_concepts
        : [page.topic_title]
      for (const label of labels) {
        add(label, topicId, {
          id: `page:${session._id}:${topicId}:${page.page_number}:${normalizeConceptKey(label)}`,
          kind: 'lesson_view',
          successful: null,
          weight: 0.25,
          observed_at: evidenceDate(page.first_viewed_at),
        })
      }
    }
  }

  for (const session of recallSessions) {
    const reviewed = new Set(((session.reviewed_item_ids as string[]) ?? []).map(String))
    for (const item of (session.items as any[]) ?? []) {
      if (!reviewed.has(String(item.id))) continue
      add(item.concept, item.topic_id ? String(item.topic_id) : null, {
        id: `recall:${session._id}:${item.id}`,
        kind: 'recall_prompt',
        successful: null,
        weight: 0.35,
        observed_at: evidenceDate(session.completed_at),
      })
    }
  }

  for (const message of doubtMessages) {
    const topicId = message.topic_id ? String(message.topic_id) : null
    const topic = topicId ? topicMap.get(topicId) : null
    const content = String(message.content ?? '').toLowerCase()
    const candidates = [
      ...((topic?.key_concepts as unknown[]) ?? []),
      topic?.title,
    ].map(String).filter(Boolean)
    const matched = candidates.filter((label) => content.includes(label.toLowerCase()))
    for (const label of matched.length ? matched : candidates.slice(0, 1)) {
      add(label, topicId, {
        id: `chat:${message._id}:${normalizeConceptKey(label)}`,
        kind: 'chat_discussion',
        successful: null,
        weight: 0.2,
        observed_at: evidenceDate(message.created_at),
      })
    }
  }

  for (const item of feedback) {
    const topicId = item.topic_id ? String(item.topic_id) : null
    const topic = topicId ? topicMap.get(topicId) : null
    const labels = ((topic?.key_concepts as unknown[]) ?? []).map(String)
    const candidates = labels.length ? labels : [String(topic?.title ?? '')]
    for (const label of candidates.slice(0, 8)) {
      add(label, topicId, {
        id: `feedback:${item._id}:${normalizeConceptKey(label)}`,
        kind: 'lesson_feedback',
        successful: item.signal === 'got_it' || item.signal === 'too_basic'
          ? true
          : item.signal === 'lost_me'
            ? false
            : null,
        weight: 0.2,
        observed_at: evidenceDate(item.updated_at ?? item.created_at),
      })
    }
  }

  for (const turn of examTurns) {
    const label = String(turn.concept ?? turn.roadmap_node_id ?? '').trim()
    const type = String(turn.type ?? 'explain')
    const difficulty = Number(turn.difficulty ?? 1)
    let kind: ConceptEvidenceKind = 'assessment_recall'
    if (type === 'explain') kind = 'assessment_explain'
    else if (type === 'apply' || type === 'code' || type === 'spot_error') {
      kind = difficulty >= 4 ? 'assessment_transfer' : 'assessment_apply'
    }
    add(label, turn.topic_id ? String(turn.topic_id) : null, {
      id: `assessment:${turn._id}`,
      kind,
      successful: Boolean((turn.evaluation as any)?.passed),
      weight: clamp(0.8 + difficulty * 0.15, 0.8, 1.6),
      observed_at: evidenceDate(turn.evaluated_at),
    })
  }

  const existingStates = await db.collection('learnerConceptStates')
    .find({ user_id: userId, course_id: courseId })
    .toArray()
  const existingMap = new Map(existingStates.map((state) => [String(state.concept_key), state]))
  const now = new Date()

  for (const [conceptKey, entry] of evidenceByConcept) {
    const estimate = deriveConceptKnowledgeEstimate(entry.evidence, now)
    const existing = existingMap.get(conceptKey)
    const overrideStage = existing?.user_override_stage as ConceptKnowledgeStage | undefined
    await db.collection('learnerConceptStates').updateOne(
      { user_id: userId, course_id: courseId, concept_key: conceptKey },
      {
        $set: {
          label: entry.label,
          topic_id: entry.topicId,
          stage: overrideStage ?? estimate.stage,
          confidence: overrideStage ? 1 : estimate.confidence,
          freshness: estimate.freshness,
          source: overrideStage ? 'explicit_user' : estimate.source,
          evidence_count: estimate.evidence_count,
          evidence_summary: estimate.evidence_summary,
          evidence_refs: entry.evidence.map((item) => item.id).slice(-100),
          last_evidence_at: estimate.last_evidence_at,
          schema_version: MEMORY_SCHEMA_VERSION,
          updated_at: now,
        },
        $setOnInsert: {
          _id: crypto.randomUUID() as any,
          user_id: userId,
          course_id: courseId,
          concept_key: conceptKey,
          created_at: now,
        },
      },
      { upsert: true },
    )
  }
}

async function expireDecayedMemories(db: Db, userId: string, courseId: string) {
  const candidates = await db.collection('learnerMemories')
    .find({
      user_id: userId,
      course_id: courseId,
      status: 'active',
      half_life_days: { $ne: null },
    })
    .toArray()
  const now = new Date()
  const expiredIds = candidates.filter((memory) =>
    memoryEffectiveConfidence({
      confidence: Number(memory.confidence ?? 0),
      authority: memory.authority as LearnerMemoryAuthority,
      halfLifeDays: Number(memory.half_life_days),
      validFrom: new Date(memory.valid_from),
      now,
    }) < MIN_EFFECTIVE_CONFIDENCE).map((memory) => memory._id)
  if (expiredIds.length) {
    await db.collection('learnerMemories').updateMany(
      { _id: { $in: expiredIds } },
      { $set: { status: 'expired', valid_to: now, updated_at: now } },
    )
  }
}

export async function syncLearnerMemoryV2({
  db,
  userId,
  courseId,
  force = false,
}: {
  db: Db
  userId: string
  courseId: string
  force?: boolean
}) {
  const syncState = await db.collection('learnerMemorySyncStates').findOne({
    user_id: userId,
    course_id: courseId,
  })
  if (
    !force
    && syncState?.synced_at
    && Date.now() - new Date(syncState.synced_at).getTime() < MEMORY_SYNC_TTL_MS
  ) {
    return { synced: false, reason: 'fresh' as const }
  }

  const course = await db.collection('courses').findOne({
    _id: courseId as any,
    user_id: userId,
  })
  if (!course) return { synced: false, reason: 'course_not_found' as const }

  await recordExplicitCourseMemories({ db, userId, courseId, course })
  await Promise.all([
    reconcileBehavioralCandidates(db, userId, courseId),
    reconcileAssessmentState(db, userId, courseId),
    reconcileConceptKnowledgeState(db, userId, courseId),
    expireDecayedMemories(db, userId, courseId),
  ])

  await db.collection('learnerMemorySyncStates').updateOne(
    { user_id: userId, course_id: courseId },
    {
      $set: { synced_at: new Date(), schema_version: MEMORY_SCHEMA_VERSION },
      $setOnInsert: { _id: crypto.randomUUID() as any, user_id: userId, course_id: courseId },
    },
    { upsert: true },
  )
  return { synced: true as const }
}

export async function getLearnerMemorySnapshot(
  db: Db,
  userId: string,
  courseId?: string,
  options: { sync?: boolean } = {},
) {
  if (courseId && options.sync !== false) {
    await syncLearnerMemoryV2({ db, userId, courseId })
  }
  const scope = { user_id: userId, ...(courseId ? { course_id: courseId } : {}) }
  const [memories, skills, conceptStates, misconceptions] = await Promise.all([
    db.collection('learnerMemories')
      .find({ ...scope, status: 'active' })
      .sort({ updated_at: -1 })
      .limit(100)
      .toArray(),
    db.collection('learnerSkillStates')
      .find(scope)
      .sort({ effective_mastery: 1, updated_at: -1 })
      .limit(100)
      .toArray(),
    db.collection('learnerConceptStates')
      .find(scope)
      .sort({ updated_at: -1 })
      .limit(200)
      .toArray(),
    db.collection('learnerMisconceptionStates')
      .find({ ...scope, status: 'active' })
      .sort({ confidence: -1, updated_at: -1 })
      .limit(50)
      .toArray(),
  ])
  const now = new Date()
  return {
    memories: memories.map((memory) => ({
      id: String(memory._id),
      user_id: String(memory.user_id),
      course_id: memory.course_id ? String(memory.course_id) : null,
      kind: memory.kind,
      key: memory.key,
      value: memory.value,
      confidence: Number(memory.confidence ?? 0),
      effective_confidence: memoryEffectiveConfidence({
        confidence: Number(memory.confidence ?? 0),
        authority: memory.authority as LearnerMemoryAuthority,
        halfLifeDays: memory.half_life_days == null ? null : Number(memory.half_life_days),
        validFrom: new Date(memory.valid_from),
        now,
      }),
      authority: memory.authority,
      source: memory.source,
      evidence_refs: memory.evidence_refs ?? [],
      status: memory.status,
      valid_from: new Date(memory.valid_from),
      valid_to: memory.valid_to ? new Date(memory.valid_to) : null,
      half_life_days: memory.half_life_days ?? null,
      sensitivity: 'standard',
      schema_version: MEMORY_SCHEMA_VERSION,
      created_at: new Date(memory.created_at),
      updated_at: new Date(memory.updated_at),
    })) as LearnerMemoryRecord[],
    skills: skills.map((skill) => {
      const effectiveMastery = effectiveSkillMastery({
        posteriorMastery: Number(skill.posterior_mastery ?? 0.5),
        stabilityDays: Number(skill.stability_days ?? 14),
        lastAssessedAt: skill.last_assessed_at ? new Date(skill.last_assessed_at) : null,
        now,
      })
      const evidenceCount = Number(skill.evidence_count ?? 0)
      return {
        course_id: String(skill.course_id),
        skill_key: String(skill.skill_key),
        label: String(skill.label),
        topic_id: skill.topic_id ? String(skill.topic_id) : null,
        evidence_count: evidenceCount,
        successful_evidence: Number(skill.successful_evidence ?? 0),
        failed_evidence: Number(skill.failed_evidence ?? 0),
        alpha: Number(skill.alpha ?? 1),
        beta: Number(skill.beta ?? 1),
        posterior_mastery: Number(skill.posterior_mastery ?? 0.5),
        effective_mastery: effectiveMastery,
        stability_days: Number(skill.stability_days ?? 14),
        state: skillState(effectiveMastery, evidenceCount),
        last_assessed_at: skill.last_assessed_at ? new Date(skill.last_assessed_at) : null,
      }
    }) as LearnerSkillState[],
    concept_states: conceptStates.map((state) => ({
      course_id: String(state.course_id),
      concept_key: String(state.concept_key),
      label: String(state.label),
      topic_id: state.topic_id ? String(state.topic_id) : null,
      stage: state.stage,
      confidence: Number(state.confidence ?? 0),
      freshness: state.freshness ?? 'unknown',
      source: state.source ?? 'observed',
      evidence_count: Number(state.evidence_count ?? 0),
      evidence_summary: state.evidence_summary ?? {},
      evidence_refs: state.evidence_refs ?? [],
      last_evidence_at: state.last_evidence_at ? new Date(state.last_evidence_at) : null,
      updated_at: new Date(state.updated_at),
    })) as LearnerConceptState[],
    misconceptions: misconceptions.map((item) => ({
      course_id: String(item.course_id),
      misconception_key: String(item.misconception_key),
      skill_key: String(item.skill_key),
      label: String(item.label),
      topic_id: item.topic_id ? String(item.topic_id) : null,
      description: String(item.description),
      confidence: Number(item.confidence ?? 0),
      evidence_count: Number(item.evidence_count ?? 0),
      correction_evidence_count: Number(item.correction_evidence_count ?? 0),
      status: item.status,
      detected_at: new Date(item.detected_at),
      corrected_at: item.corrected_at ? new Date(item.corrected_at) : null,
    })) as LearnerMisconceptionState[],
  }
}

export function formatLearnerMemoryContext(
  snapshot: Awaited<ReturnType<typeof getLearnerMemorySnapshot>>,
) {
  const explicitPreferences = snapshot.memories
    .filter((memory) =>
      memory.effective_confidence >= 0.5
      && (memory.kind === 'preference' || memory.kind === 'profile'))
    .slice(0, 6)
    .map((memory) => `${memory.key}: ${String(memory.value).replace(/_/g, ' ')}`)
  const developingSkills = snapshot.skills
    .filter((skill) => skill.evidence_count >= 2 && skill.state === 'developing')
    .slice(0, 5)
    .map((skill) => skill.label)
  const strongSkills = snapshot.skills
    .filter((skill) => skill.evidence_count >= 2 && skill.state === 'strong')
    .slice(0, 4)
    .map((skill) => skill.label)
  const misconceptions = snapshot.misconceptions
    .slice(0, 5)
    .map((item) => item.description)

  const lines = [
    explicitPreferences.length ? `- Active learner preferences/profile: ${explicitPreferences.join('; ')}` : null,
    developingSkills.length ? `- Assessment-backed skills still developing: ${developingSkills.join('; ')}` : null,
    strongSkills.length ? `- Assessment-backed strengths: ${strongSkills.join('; ')}` : null,
    misconceptions.length ? `- Unresolved assessed misconceptions: ${misconceptions.join('; ')}` : null,
  ].filter(Boolean)
  if (!lines.length) return ''

  return [
    'LEARNER MEMORY V2 (personalization only, never factual evidence):',
    ...lines,
    '- Use this to adjust explanation, pacing, and examples. It must not change source facts or justify claims about the course content.',
    '- Do not claim the learner has mastered or corrected anything beyond the assessment-backed wording above.',
  ].join('\n')
}

export async function correctLearnerMemory({
  db,
  userId,
  memoryId,
  value,
}: {
  db: Db
  userId: string
  memoryId: string
  value: unknown
}) {
  const existing = await db.collection('learnerMemories').findOne({
    _id: memoryId as any,
    user_id: userId,
  })
  if (!existing) return null
  const key = String(existing.key)
  if (
    key === 'teaching.knowledge_level'
    && !['beginner', 'intermediate', 'expert'].includes(String(value))
  ) {
    throw new Error('Knowledge level must be beginner, intermediate, or expert.')
  }
  if (
    key === 'teaching.source_coverage'
    && !['complete', 'smart', 'core'].includes(String(value))
  ) {
    throw new Error('Source coverage must be complete, smart, or core.')
  }
  const result = await upsertLearnerMemory(db, {
    userId,
    courseId: existing.course_id ? String(existing.course_id) : null,
    kind: existing.kind as LearnerMemoryKind,
    key: String(existing.key),
    value,
    confidence: 1,
    authority: 'explicit_user',
    source: 'user_correction',
    evidenceRefs: [`memory:${memoryId}`],
  })
  const courseId = existing.course_id ? String(existing.course_id) : null
  if (courseId) {
    const update: Record<string, unknown> = { updated_at: new Date() }
    if (key === 'teaching.knowledge_level' && ['beginner', 'intermediate', 'expert'].includes(String(value))) {
      update.knowledge_level = String(value)
    } else if (key === 'teaching.source_coverage' && ['complete', 'smart', 'core'].includes(String(value))) {
      update.source_coverage_preference = String(value)
    } else if (key === 'learner.audience') {
      update.learner_audience = { label: String(value).slice(0, 120), directive: '', source: 'stated' }
    }
    await db.collection('courses').updateOne(
      { _id: courseId as any, user_id: userId },
      { $set: update },
    )
    await db.collection('learnerProfiles').deleteOne({ user_id: userId, course_id: courseId })
  }
  return result
}

export async function correctLearnerConceptState({
  db,
  userId,
  courseId,
  conceptKey,
  stage,
}: {
  db: Db
  userId: string
  courseId: string
  conceptKey: string
  stage: ConceptKnowledgeStage
}) {
  const allowed: ConceptKnowledgeStage[] = [
    'never_encountered',
    'recognizes',
    'understands',
    'applies',
    'transfers',
    'forgetting',
  ]
  if (!allowed.includes(stage)) throw new Error('Invalid concept knowledge stage.')
  const existing = await db.collection('learnerConceptStates').findOne({
    user_id: userId,
    course_id: courseId,
    concept_key: conceptKey,
  })
  if (!existing) return null
  const now = new Date()
  await db.collection('learnerConceptStates').updateOne(
    { _id: existing._id },
    {
      $set: {
        stage,
        confidence: 1,
        source: 'explicit_user',
        user_override_stage: stage,
        user_override_at: now,
        updated_at: now,
      },
    },
  )
  await Promise.all([
    db.collection('learnerProfiles').deleteOne({ user_id: userId, course_id: courseId }),
    db.collection('learningEvents').insertOne({
      _id: crypto.randomUUID() as any,
      user_id: userId,
      course_id: courseId,
      topic_id: existing.topic_id ?? null,
      event_type: 'learner_concept_state_corrected',
      concept_key: conceptKey,
      concept_label: existing.label,
      previous_stage: existing.stage,
      corrected_stage: stage,
      created_at: now,
    }),
  ])
  return { conceptKey, stage }
}

export async function deleteLearnerMemory(db: Db, userId: string, memoryId: string) {
  const memory = await db.collection('learnerMemories').findOne({
    _id: memoryId as any,
    user_id: userId,
  })
  if (!memory) return false
  const now = new Date()
  const result = await db.collection('learnerMemories').updateOne(
    { _id: memoryId as any, user_id: userId, status: { $ne: 'deleted' } },
    {
      $set: {
        status: 'deleted',
        valid_to: now,
        deleted_at: now,
        deleted_by_user: true,
        updated_at: now,
      },
    },
  )
  const courseId = memory.course_id ? String(memory.course_id) : null
  if (courseId) {
    const key = String(memory.key)
    if (key === 'teaching.knowledge_level') {
      await db.collection('courses').updateOne(
        { _id: courseId as any, user_id: userId },
        { $unset: { knowledge_level: '' }, $set: { updated_at: now } },
      )
    } else if (key === 'teaching.source_coverage') {
      await db.collection('courses').updateOne(
        { _id: courseId as any, user_id: userId },
        { $unset: { source_coverage_preference: '' }, $set: { updated_at: now } },
      )
    } else if (key === 'learner.audience') {
      await db.collection('courses').updateOne(
        { _id: courseId as any, user_id: userId },
        { $unset: { learner_audience: '', learner_persona: '' }, $set: { updated_at: now } },
      )
    }
    await Promise.all([
      db.collection('learnerProfiles').deleteOne({ user_id: userId, course_id: courseId }),
      db.collection('learnerMemorySyncStates').deleteOne({ user_id: userId, course_id: courseId }),
    ])
  }
  return result.matchedCount > 0
}
