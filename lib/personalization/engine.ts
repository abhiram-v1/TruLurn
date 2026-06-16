import type { Db } from 'mongodb'
import {
  getLearnerMemorySnapshot,
  syncLearnerMemoryV2,
} from '@/lib/memory/service'
import type { LearnerConceptState } from '@/lib/memory/types'
import { conceptTeachingGuidance } from '@/lib/personalization/conceptKnowledge'

// ── Personalization engine ────────────────────────────────────────────────────
// Builds a per-(user, course) learner profile from observed behavior — lesson
// feedback, exam results, recall-break ratings, doubt activity, and study pace —
// and turns it into learner-state evidence for the active teaching persona.
// It does not choose page structure, analogy count, examples, or interaction
// style. The profile is cached and refreshed lazily.

const PROFILE_TTL_MS = 10 * 60 * 1000
// Below this many total signals the profile is noise — inject nothing.
const MIN_SIGNALS = 3

export type LearnerProfile = {
  user_id: string
  course_id: string
  signals: {
    feedback: number
    exams: number
    recalls: number
    doubts: number
  }
  /** From lesson feedback + exam pass rate: how the current difficulty lands. */
  comprehension: 'struggling' | 'steady' | 'cruising'
  /** From recall-break self-ratings: how well recent material sticks. */
  retention: 'weak' | 'mixed' | 'strong'
  /** From study sessions: pages consumed per active hour. */
  pace: 'deliberate' | 'moderate' | 'fast'
  /** Concepts the student demonstrably struggles with (exams, recalls). */
  struggle_concepts: string[]
  /** Concepts with strong demonstrated recall/mastery. */
  strong_concepts: string[]
  /** Topic titles attracting disproportionate doubt-chat activity. */
  doubt_hotspots: string[]
  /** Active, high-confidence preferences and observations from Memory V2. */
  durable_preferences: string[]
  /** Assessment-backed misconceptions not yet corrected by later evidence. */
  active_misconceptions: string[]
  /** Evidence-backed concept state, separate from the learner's declared level. */
  concept_states: LearnerConceptState[]
  updated_at: Date
}

function ratio(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0
}

function durablePreferenceText(memory: {
  key: string
  value: unknown
  authority: string
}) {
  const value = String(memory.value).replace(/_/g, ' ')
  if (memory.key === 'teaching.knowledge_level') return `Teach at ${value} level`
  if (memory.key === 'teaching.source_coverage') return `Use ${value} source coverage`
  if (memory.key === 'learning.comprehension_support') {
    return value === 'needs more support'
      ? 'Repeated feedback suggests more scaffolding may help'
      : 'Repeated feedback suggests the learner may be ready for more depth'
  }
  return `${memory.key.replace(/[._-]+/g, ' ')}: ${value}`
}

async function computeLearnerProfile(db: Db, userId: string, courseId: string): Promise<LearnerProfile> {
  const [feedback, examSessions, recallSessions, doubtAgg, studySessions, weakTopics, memorySnapshot] = await Promise.all([
    db.collection('lessonFeedback')
      .find({ user_id: userId, course_id: courseId })
      .project({ signal: 1 })
      .toArray(),
    db.collection('examSessions')
      .find({ user_id: userId, course_id: courseId, status: 'completed' })
      .sort({ completed_at: -1 })
      .limit(12)
      .project({ summary: 1 })
      .toArray(),
    db.collection('recallSessions')
      .find({ user_id: userId, course_id: courseId, status: 'completed' })
      .sort({ completed_at: -1 })
      .limit(10)
      .project({ stats: 1, items: 1 })
      .toArray(),
    db.collection('doubtMessages')
      .aggregate([
        { $match: { course_id: courseId, user_id: userId, role: 'user' } },
        { $group: { _id: '$topic_id', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ])
      .toArray(),
    db.collection('studySessions')
      .find({ user_id: userId, course_id: courseId })
      .sort({ started_at: -1 })
      .limit(8)
      .project({ active_ms: 1, pages: 1 })
      .toArray(),
    db.collection('topics')
      .find({ course_id: courseId, state: { $in: ['unstable', 'partial'] } })
      .project({ title: 1, key_concepts: 1 })
      .limit(10)
      .toArray(),
    getLearnerMemorySnapshot(db, userId, courseId),
  ])

  // ── Comprehension: lesson feedback + exam outcomes ──
  const lostMe = feedback.filter((f) => f.signal === 'lost_me').length
  const tooBasic = feedback.filter((f) => f.signal === 'too_basic').length
  const examsPassed = examSessions.filter((s) => Boolean((s.summary as any)?.passed)).length
  const examPassRate = ratio(examsPassed, examSessions.length)

  let comprehension: LearnerProfile['comprehension'] = 'steady'
  const struggleScore =
    ratio(lostMe, Math.max(1, feedback.length)) * 2 +
    (examSessions.length >= 2 ? (1 - examPassRate) : 0)
  const cruiseScore =
    ratio(tooBasic, Math.max(1, feedback.length)) * 2 +
    (examSessions.length >= 2 ? examPassRate - 0.8 : 0)
  if (struggleScore >= 0.8) comprehension = 'struggling'
  else if (cruiseScore >= 0.8) comprehension = 'cruising'

  // ── Retention: recall-break self-ratings ──
  let recallTotal = 0
  let recallGot = 0
  let recallForgot = 0
  const struggleConceptCounts = new Map<string, number>()
  const strongConceptCounts = new Map<string, number>()
  for (const session of recallSessions) {
    const stats = session.stats as any
    if (stats) {
      recallTotal += Number(stats.total ?? 0)
      recallGot += Number(stats.got_it ?? 0)
      recallForgot += Number(stats.forgot ?? 0)
    }
    for (const item of (session.items as any[]) ?? []) {
      const concept = String(item?.concept ?? '').trim()
      if (!concept) continue
      if (item.rating === 'forgot' || item.rating === 'shaky') {
        struggleConceptCounts.set(concept, (struggleConceptCounts.get(concept) ?? 0) + 1)
      } else if (item.rating === 'got_it') {
        strongConceptCounts.set(concept, (strongConceptCounts.get(concept) ?? 0) + 1)
      }
    }
  }
  let retention: LearnerProfile['retention'] = 'mixed'
  if (recallTotal >= 4) {
    const gotRate = ratio(recallGot, recallTotal)
    const forgotRate = ratio(recallForgot, recallTotal)
    if (gotRate >= 0.75 && forgotRate <= 0.1) retention = 'strong'
    else if (forgotRate >= 0.3 || gotRate < 0.45) retention = 'weak'
  }

  // ── Weak concepts from exams (review_concepts) and unstable topics ──
  for (const session of examSessions) {
    const review = (session.summary as any)?.review_concepts
    if (Array.isArray(review)) {
      for (const concept of review) {
        const clean = String(concept).trim()
        if (clean) struggleConceptCounts.set(clean, (struggleConceptCounts.get(clean) ?? 0) + 2)
      }
    }
  }
  for (const topic of weakTopics) {
    const title = String(topic.title ?? '').trim()
    if (title) struggleConceptCounts.set(title, (struggleConceptCounts.get(title) ?? 0) + 1)
  }

  for (const skill of memorySnapshot.skills) {
    if (skill.evidence_count < 2) continue
    if (skill.effective_mastery < 0.55) {
      struggleConceptCounts.set(skill.label, (struggleConceptCounts.get(skill.label) ?? 0) + 3)
    } else if (skill.effective_mastery >= 0.78 && !struggleConceptCounts.has(skill.label)) {
      strongConceptCounts.set(skill.label, (strongConceptCounts.get(skill.label) ?? 0) + 3)
    }
  }
  const memoryStruggleConcepts = [...struggleConceptCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([concept]) => concept)
  const memoryStrongConcepts = [...strongConceptCounts.entries()]
    .filter(([concept]) => !struggleConceptCounts.has(concept))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([concept]) => concept)
  const durablePreferences = memorySnapshot.memories
    .filter((memory) =>
      memory.effective_confidence >= 0.5
      && (memory.kind === 'preference' || memory.kind === 'observation'))
    .map(durablePreferenceText)
    .filter(Boolean)
    .slice(0, 8)
  const activeMisconceptions = memorySnapshot.misconceptions
    .map((item) => item.description)
    .filter(Boolean)
    .slice(0, 6)

  // ── Doubt hotspots (topic titles) ──
  const hotspotTopicIds = doubtAgg.filter((d) => Number(d.count ?? 0) >= 3).map((d) => String(d._id))
  let doubtHotspots: string[] = []
  if (hotspotTopicIds.length) {
    const hotspotTopics = await db.collection('topics')
      .find({ _id: { $in: hotspotTopicIds as any[] }, course_id: courseId })
      .project({ title: 1 })
      .toArray()
    doubtHotspots = hotspotTopics.map((t) => String(t.title ?? '')).filter(Boolean).slice(0, 4)
  }

  // ── Pace: pages per active hour across recent sessions ──
  const totalActiveMs = studySessions.reduce((sum, s) => sum + Number(s.active_ms ?? 0), 0)
  const totalPages = studySessions.reduce((sum, s) => sum + ((s.pages as any[])?.length ?? 0), 0)
  let pace: LearnerProfile['pace'] = 'moderate'
  if (totalActiveMs >= 20 * 60 * 1000 && totalPages >= 3) {
    const pagesPerHour = totalPages / (totalActiveMs / 3_600_000)
    if (pagesPerHour >= 9) pace = 'fast'
    else if (pagesPerHour <= 4) pace = 'deliberate'
  }

  return {
    user_id: userId,
    course_id: courseId,
    signals: {
      feedback: feedback.length,
      exams: examSessions.length,
      recalls: recallSessions.length,
      doubts: doubtAgg.reduce((sum, d) => sum + Number(d.count ?? 0), 0),
    },
    comprehension,
    retention,
    pace,
    struggle_concepts: memoryStruggleConcepts,
    strong_concepts: memoryStrongConcepts,
    doubt_hotspots: doubtHotspots,
    durable_preferences: durablePreferences,
    active_misconceptions: activeMisconceptions,
    concept_states: memorySnapshot.concept_states,
    updated_at: new Date(),
  }
}

/**
 * Cached learner profile — recomputed when older than PROFILE_TTL_MS.
 */
export async function getLearnerProfile(db: Db, userId: string, courseId: string): Promise<LearnerProfile> {
  await syncLearnerMemoryV2({ db, userId, courseId }).catch((error) => {
    console.warn('[personalization] Memory V2 sync unavailable.', error)
  })
  const cached = await db.collection('learnerProfiles').findOne({
    user_id: userId,
    course_id: courseId,
  })

  if (cached && Date.now() - new Date(cached.updated_at).getTime() < PROFILE_TTL_MS) {
    return cached as unknown as LearnerProfile
  }

  const profile = await computeLearnerProfile(db, userId, courseId)
  await db.collection('learnerProfiles').updateOne(
    { user_id: userId, course_id: courseId },
    { $set: profile },
    { upsert: true },
  )
  return profile
}

/**
 * Turn the profile into a prompt block for the lesson writer. Returns '' when
 * there isn't enough observed behavior to personalize honestly.
 */
function conceptRelevant(label: string, relevantConcepts: string[]) {
  const normalized = label.toLowerCase()
  return relevantConcepts.some((concept) => {
    const candidate = concept.toLowerCase()
    return normalized.includes(candidate) || candidate.includes(normalized)
  })
}

export function buildLearnerStateContext(
  profile: LearnerProfile | null | undefined,
  relevantConcepts: string[] = [],
): string {
  if (!profile) return ''
  const totalSignals =
    profile.signals.feedback + profile.signals.exams + profile.signals.recalls +
    (profile.signals.doubts > 0 ? 1 : 0)
  if (totalSignals < MIN_SIGNALS && !(profile.concept_states?.length)) return ''

  const lines: string[] = [
    'LEARNER STATE EVIDENCE (use within the active teaching persona; this does not override persona structure):',
  ]

  if (profile.comprehension === 'struggling') {
    lines.push('- Current comprehension evidence is weak. Treat prerequisite links as uncertain, expose hidden steps, and verify the missing link before building on it.')
  } else if (profile.comprehension === 'cruising') {
    lines.push('- Current comprehension evidence is strong. Compress already-demonstrated basics and spend attention on the assigned new mechanism, boundary, or transfer.')
  }

  if (profile.retention === 'weak') {
    lines.push('- Recall evidence is weak. A brief callback or retrieval cue may help when it fits the persona path and page contract.')
  } else if (profile.retention === 'strong') {
    lines.push('- Recall evidence is strong. Do not add reinforcement that the page objective does not need.')
  }

  const relevantWeak = relevantConcepts.length
    ? profile.struggle_concepts.filter((concept) => conceptRelevant(concept, relevantConcepts))
    : []
  const relevantStrong = relevantConcepts.length
    ? profile.strong_concepts.filter((concept) => conceptRelevant(concept, relevantConcepts))
    : []
  const relevantStates = relevantConcepts.length
    ? (profile.concept_states ?? []).filter((state) => conceptRelevant(state.label, relevantConcepts))
    : []
  const absentRelevantConcepts = relevantConcepts.filter((concept) =>
    !relevantStates.some((state) => conceptRelevant(state.label, [concept])))

  if (relevantWeak.length) {
    lines.push(`- Relevant weak spots: ${relevantWeak.join('; ')}.`)
    lines.push('  Treat these as not yet solid. Re-anchor only the dependency this page actually needs.')
  }

  if (relevantStrong.length) {
    lines.push(`- Relevant demonstrated strengths: ${relevantStrong.join('; ')}. These are safe to build on without re-explanation.`)
  }

  for (const state of relevantStates.slice(0, 8)) {
    lines.push(`- ${conceptTeachingGuidance(state.label, state)}`)
  }

  for (const concept of absentRelevantConcepts.slice(0, 5)) {
    lines.push(`- ${concept}: no encounter or assessment evidence is recorded. Introduce or briefly verify it before depending on it.`)
  }

  const relevantHotspots = relevantConcepts.length
    ? profile.doubt_hotspots.filter((concept) => conceptRelevant(concept, relevantConcepts))
    : []
  if (relevantHotspots.length) {
    lines.push(`- The student asked many questions about: ${relevantHotspots.join('; ')}. Address the confusion class directly instead of restating the original explanation.`)
  }

  if (profile.durable_preferences?.length) {
    lines.push(`- Durable learner preferences: ${profile.durable_preferences.join('; ')}.`)
    lines.push('  â†’ Follow explicit preferences first. Treat behavior-derived observations as suggestions, not facts about the learner.')
  }

  const relevantMisconceptions = relevantConcepts.length
    ? (profile.active_misconceptions ?? []).filter((item) => conceptRelevant(item, relevantConcepts))
    : []
  if (relevantMisconceptions.length) {
    lines.push(`- Relevant assessment-backed misconceptions still active: ${relevantMisconceptions.join('; ')}.`)
    lines.push('  â†’ Address these carefully when relevant. Do not claim they are corrected until later assessment evidence says so.')
  }

  // Nothing beyond the header → nothing worth injecting.
  return lines.length > 1 ? lines.join('\n') : ''
}
