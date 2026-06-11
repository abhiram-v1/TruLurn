import type { Db } from 'mongodb'

// ── Personalization engine ────────────────────────────────────────────────────
// Builds a per-(user, course) learner profile from observed behavior — lesson
// feedback, exam results, recall-break ratings, doubt activity, and study pace —
// and turns it into a prompt directive that adjusts how new lesson pages teach:
// explanation depth, example count, analogy usage, practice frequency, and
// concept sequencing. The profile is cached and refreshed lazily, so page
// generation pays a few indexed reads at most.

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
  updated_at: Date
}

function ratio(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0
}

async function computeLearnerProfile(db: Db, userId: string, courseId: string): Promise<LearnerProfile> {
  const [feedback, examSessions, recallSessions, doubtAgg, studySessions, weakTopics] = await Promise.all([
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

  const struggleConcepts = [...struggleConceptCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([concept]) => concept)
  const strongConcepts = [...strongConceptCounts.entries()]
    .filter(([concept]) => !struggleConceptCounts.has(concept))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([concept]) => concept)

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
    struggle_concepts: struggleConcepts,
    strong_concepts: strongConcepts,
    doubt_hotspots: doubtHotspots,
    updated_at: new Date(),
  }
}

/**
 * Cached learner profile — recomputed when older than PROFILE_TTL_MS.
 */
export async function getLearnerProfile(db: Db, userId: string, courseId: string): Promise<LearnerProfile> {
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
export function buildPersonalizationDirective(profile: LearnerProfile | null | undefined): string {
  if (!profile) return ''
  const totalSignals =
    profile.signals.feedback + profile.signals.exams + profile.signals.recalls +
    (profile.signals.doubts > 0 ? 1 : 0)
  if (totalSignals < MIN_SIGNALS) return ''

  const lines: string[] = [
    'LEARNER PROFILE (observed from this student\'s actual behavior in this course — adapt the page to it):',
  ]

  if (profile.comprehension === 'struggling') {
    lines.push('- Comprehension: the student is finding the current level HARD (frequent "lost me" signals / failed quizzes).')
    lines.push('  → Increase explanation depth: smaller steps, one idea at a time, define terms on contact.')
    lines.push('  → Add one more concrete example than you normally would, and prefer everyday analogies before formalism.')
  } else if (profile.comprehension === 'cruising') {
    lines.push('- Comprehension: the current level is too EASY for this student ("too basic" signals / consistently strong quizzes).')
    lines.push('  → Reduce hand-holding: compress basics, skip re-motivation, go further into nuance and edge cases.')
    lines.push('  → Fewer introductory examples; one sharp example beats three gentle ones.')
  }

  if (profile.retention === 'weak') {
    lines.push('- Retention: recall checks show material is NOT sticking.')
    lines.push('  → Raise practice frequency: include a checkpoints section or end-of-page retrieval prompt where the concept allows it.')
    lines.push('  → Weave brief callbacks to earlier concepts into the prose (spaced reinforcement), and keep new-concept count per page low.')
  } else if (profile.retention === 'strong') {
    lines.push('- Retention: recall checks are consistently strong — material sticks on first pass.')
    lines.push('  → Standard practice frequency is enough; do not pad pages with extra self-checks.')
  }

  if (profile.pace === 'fast') {
    lines.push('- Pace: the student moves FAST through pages. Keep prose tight; cut transitions and recap padding.')
  } else if (profile.pace === 'deliberate') {
    lines.push('- Pace: the student studies slowly and carefully. Full explanations are welcome; do not artificially compress.')
  }

  if (profile.struggle_concepts.length) {
    lines.push(`- Known weak spots: ${profile.struggle_concepts.join('; ')}.`)
    lines.push('  → When this page touches one of these, treat it as NOT yet solid: re-anchor it in one sentence before building on it, and prefer it as the subject of examples.')
    lines.push('  → If this page formally depends on one of these, sequence the page to repair that foundation first.')
  }

  if (profile.strong_concepts.length) {
    lines.push(`- Demonstrated strengths: ${profile.strong_concepts.join('; ')}. Use these as anchors for analogies and bridges — they are safe to build on without re-explanation.`)
  }

  if (profile.doubt_hotspots.length) {
    lines.push(`- The student asked many questions about: ${profile.doubt_hotspots.join('; ')}. When relevant, address the confusion class directly instead of restating the original explanation.`)
  }

  // Nothing beyond the header → nothing worth injecting.
  return lines.length > 1 ? lines.join('\n') : ''
}
