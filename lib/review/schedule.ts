import crypto from 'crypto'
import type { Db } from 'mongodb'

// ── Spaced repetition engine ───────────────────────────────────────────────────
// TruLurn is a mastery system, so retention over time is the whole point. Passing a
// quiz once is not mastery — it's the start of a forgetting curve. This schedules
// retrieval reviews at expanding intervals and contracts them when a review fails.
//
// One reviewSchedule doc per (user, course, topic). It moves through INTERVALS as
// the student keeps passing reviews; a failed review resets the cadence and flips
// the topic back to `unstable` so the system surfaces it again.

// Expanding intervals in days. Index advances on each passed review.
const INTERVALS_DAYS = [1, 3, 7, 14, 30, 60, 120]

export type ReviewScheduleDoc = {
  _id: string
  user_id: string
  course_id: string
  topic_id: string
  status: 'scheduled' | 'retired'
  interval_index: number
  due_at: Date
  last_reviewed_at: Date | null
  review_count: number
  created_at: Date
  updated_at: Date
}

export type DueReview = {
  id: string
  course_id: string
  course_title: string
  topic_id: string
  topic_title: string
  due_at: string
  interval_index: number
  review_count: number
  overdue_days: number
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000)
}

function intervalForIndex(index: number): number {
  const clamped = Math.max(0, Math.min(index, INTERVALS_DAYS.length - 1))
  return INTERVALS_DAYS[clamped]
}

/**
 * Schedule (or keep) a topic's first review after it is passed.
 * Idempotent: re-passing a topic that already has a live schedule does not reset it.
 */
export async function scheduleTopicReview({
  db,
  courseId,
  topicId,
  userId,
  passed,
  overallLevel,
}: {
  db: Db
  courseId: string
  topicId: string
  userId: string
  passed: boolean
  overallLevel?: number
}): Promise<void> {
  if (!passed) return

  const existing = await db.collection('reviewSchedule').findOne({
    user_id: userId,
    course_id: courseId,
    topic_id: topicId,
  })

  // Already tracking this topic — leave the existing cadence intact.
  if (existing && existing.status === 'scheduled') return

  const now = new Date()
  // A strong first pass (level 4–5) earns a slightly longer first interval.
  const startIndex = (overallLevel ?? 0) >= 4 ? 1 : 0

  await db.collection('reviewSchedule').updateOne(
    { user_id: userId, course_id: courseId, topic_id: topicId },
    {
      // _id and created_at are immutable — only ever set them on insert.
      $setOnInsert: {
        _id: crypto.randomUUID() as any,
        user_id: userId,
        course_id: courseId,
        topic_id: topicId,
        created_at: now,
      },
      $set: {
        status: 'scheduled',
        interval_index: startIndex,
        due_at: addDays(now, intervalForIndex(startIndex)),
        last_reviewed_at: null,
        review_count: 0,
        updated_at: now,
      },
    },
    { upsert: true },
  )
}

/**
 * Remove a topic's review schedule — used when a topic is failed and is no longer
 * a mastery candidate (it goes back into active learning, not review).
 */
export async function cancelTopicReview({
  db,
  courseId,
  topicId,
  userId,
}: {
  db: Db
  courseId: string
  topicId: string
  userId: string
}): Promise<void> {
  await db.collection('reviewSchedule').deleteOne({
    user_id: userId,
    course_id: courseId,
    topic_id: topicId,
  })
}

/**
 * Record the outcome of a completed review.
 * Pass → advance to the next, longer interval.
 * Fail → reset to the start, push the topic back to `unstable` so it resurfaces.
 */
export async function recordReviewResult({
  db,
  courseId,
  topicId,
  userId,
  passed,
}: {
  db: Db
  courseId: string
  topicId: string
  userId: string
  passed: boolean
}): Promise<void> {
  const schedule = await db.collection('reviewSchedule').findOne({
    user_id: userId,
    course_id: courseId,
    topic_id: topicId,
  })
  if (!schedule) return

  const now = new Date()
  const currentIndex = Number(schedule.interval_index ?? 0)
  const reviewCount = Number(schedule.review_count ?? 0) + 1

  if (passed) {
    const nextIndex = Math.min(currentIndex + 1, INTERVALS_DAYS.length - 1)
    await db.collection('reviewSchedule').updateOne(
      { _id: schedule._id },
      {
        $set: {
          interval_index: nextIndex,
          due_at: addDays(now, intervalForIndex(nextIndex)),
          last_reviewed_at: now,
          review_count: reviewCount,
          status: 'scheduled',
          updated_at: now,
        },
      },
    )
  } else {
    // Failed retrieval: reset the cadence and resurface the topic for relearning.
    await db.collection('reviewSchedule').updateOne(
      { _id: schedule._id },
      {
        $set: {
          interval_index: 0,
          due_at: addDays(now, intervalForIndex(0)),
          last_reviewed_at: now,
          review_count: reviewCount,
          status: 'scheduled',
          updated_at: now,
        },
      },
    )
    await db.collection('topics').updateOne(
      { _id: topicId as any, course_id: courseId, state: { $in: ['mastered', 'functional', 'done'] } },
      { $set: { state: 'unstable', needs_review: true, updated_at: now } },
    )
  }
}

/**
 * List reviews that are due now (or overdue), newest-due first, joined with topic
 * and course titles for display. Optionally scoped to a single course.
 */
export async function getDueReviews({
  db,
  userId,
  courseId,
  now = new Date(),
  limit = 50,
}: {
  db: Db
  userId: string
  courseId?: string
  now?: Date
  limit?: number
}): Promise<DueReview[]> {
  const query: Record<string, unknown> = {
    user_id: userId,
    status: 'scheduled',
    due_at: { $lte: now },
  }
  if (courseId) query.course_id = courseId

  const schedules = await db.collection('reviewSchedule')
    .find(query)
    .sort({ due_at: 1 })
    .limit(limit)
    .toArray()

  if (!schedules.length) return []

  const topicIds = [...new Set(schedules.map((s) => String(s.topic_id)))]
  const courseIds = [...new Set(schedules.map((s) => String(s.course_id)))]

  const [topics, courses] = await Promise.all([
    db.collection('topics')
      .find({ _id: { $in: topicIds as any[] } })
      .project({ title: 1, state: 1 })
      .toArray(),
    db.collection('courses')
      .find({ _id: { $in: courseIds as any[] } })
      .project({ title: 1 })
      .toArray(),
  ])

  const topicById = new Map(topics.map((t) => [String(t._id), t]))
  const courseTitleById = new Map(courses.map((c) => [String(c._id), String(c.title ?? 'Course')]))

  return schedules
    .map((s) => {
      const topic = topicById.get(String(s.topic_id))
      // Skip orphaned schedules whose topic was deleted.
      if (!topic) return null
      const dueAt = s.due_at instanceof Date ? s.due_at : new Date(s.due_at)
      const overdueMs = now.getTime() - dueAt.getTime()
      return {
        id: String(s._id),
        course_id: String(s.course_id),
        course_title: courseTitleById.get(String(s.course_id)) ?? 'Course',
        topic_id: String(s.topic_id),
        topic_title: String(topic.title ?? 'Topic'),
        due_at: dueAt.toISOString(),
        interval_index: Number(s.interval_index ?? 0),
        review_count: Number(s.review_count ?? 0),
        overdue_days: Math.max(0, Math.floor(overdueMs / (24 * 60 * 60 * 1000))),
      } as DueReview
    })
    .filter((item): item is DueReview => item !== null)
}

/**
 * Count due reviews — cheap enough for a badge/indicator.
 */
export async function countDueReviews({
  db,
  userId,
  courseId,
  now = new Date(),
}: {
  db: Db
  userId: string
  courseId?: string
  now?: Date
}): Promise<number> {
  const query: Record<string, unknown> = {
    user_id: userId,
    status: 'scheduled',
    due_at: { $lte: now },
  }
  if (courseId) query.course_id = courseId
  return db.collection('reviewSchedule').countDocuments(query)
}
