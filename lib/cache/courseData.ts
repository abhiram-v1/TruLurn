// Cached accessors for read-mostly course structure (course doc, topics,
// branches) and derived graph data. These are the documents re-fetched on every
// lesson navigation and graph view; caching them removes the bulk of redundant
// MongoDB round-trips during an active study session.
//
// Invalidation: every entry is tagged `course:<id>`. Any write that changes a
// course's structure or a topic's state must call invalidateCourse(courseId).
// A short TTL backstops any missed invalidation so staleness self-heals.

import type { Db } from 'mongodb'
import { appCache } from '@/lib/cache/memoryCache'

const COURSE_TTL_MS = Number(process.env.COURSE_CACHE_TTL_MS) || 24 * 60 * 60 * 1000
const GRAPH_TTL_MS = Number(process.env.GRAPH_CACHE_TTL_MS) || 24 * 60 * 60 * 1000

function courseTag(courseId: string) {
  return `course:${courseId}`
}

/** Canonical course-wide topic ordering (mirrors the `topics_course_order` index). */
function compareCourseTopics(a: any, b: any): number {
  return (
    (Number(a.branch_position ?? 0) - Number(b.branch_position ?? 0))
    || String(a.branch_id ?? '').localeCompare(String(b.branch_id ?? ''))
    || (Number(a.sequence_index ?? 0) - Number(b.sequence_index ?? 0))
    || (Number(a.position ?? 0) - Number(b.position ?? 0))
    || (new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime())
  )
}

/** The course document, scoped to its owner. Returned object is read-only by convention. */
export async function getCachedCourse(db: Db, courseId: string, userId: string) {
  return appCache.getOrLoad(
    `course:doc:${courseId}:${userId}`,
    () => db.collection('courses').findOne({ _id: courseId as any, user_id: userId }),
    { ttlMs: COURSE_TTL_MS, tags: [courseTag(courseId)] },
  )
}

/**
 * All topic documents for a course, sorted in canonical course order. Callers
 * receive a fresh shallow copy each call so in-place `.sort()`/`.reverse()`
 * cannot corrupt the cached array. (Document fields must not be mutated.)
 */
export async function getCachedCourseTopics(db: Db, courseId: string): Promise<any[]> {
  const topics = await appCache.getOrLoad(
    `course:topics:${courseId}`,
    async () => {
      const docs = await db.collection('topics').find({ course_id: courseId }).toArray()
      docs.sort(compareCourseTopics)
      return docs
    },
    { ttlMs: COURSE_TTL_MS, tags: [courseTag(courseId)] },
  )
  return [...topics]
}

/** All branch documents for a course, sorted by creation order. Shallow-copied. */
export async function getCachedCourseBranches(db: Db, courseId: string): Promise<any[]> {
  const branches = await appCache.getOrLoad(
    `course:branches:${courseId}`,
    async () => {
      const docs = await db.collection('branches').find({ course_id: courseId }).toArray()
      docs.sort((a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime())
      return docs
    },
    { ttlMs: COURSE_TTL_MS, tags: [courseTag(courseId)] },
  )
  return [...branches]
}

/**
 * Cache a fully-built, serializable graph payload by (course, user, view). The
 * graph transform (layout, BFS cascades, critical-path DP) is CPU-heavy and the
 * result changes only as the learner studies, so a short TTL plus course-tag
 * invalidation keeps it both fast and fresh.
 */
export async function getCachedGraphData<T>(
  courseId: string,
  userId: string,
  view: string,
  loader: () => Promise<T>,
): Promise<T> {
  return appCache.getOrLoad(
    `course:graph:${courseId}:${userId}:${view}`,
    loader,
    { ttlMs: GRAPH_TTL_MS, tags: [courseTag(courseId)] },
  )
}

/** Drop every cached entry for a course. Call after any structural/state write. */
export function invalidateCourse(courseId: string): void {
  appCache.invalidateTag(courseTag(courseId))
}

/** Get a single topic by ID, from cache. */
export async function getCachedTopic(db: Db, courseId: string, topicId: string) {
  const topics = await getCachedCourseTopics(db, courseId)
  return topics.find((t) => String(t._id) === String(topicId)) ?? null
}

/** All pages for a topic, cached and sorted by page number. */
export async function getCachedTopicPages(db: Db, courseId: string, topicId: string): Promise<any[]> {
  const pages = await appCache.getOrLoad(
    `course:pages:${courseId}:${topicId}`,
    async () => {
      const docs = await db.collection('pages').find({ course_id: courseId, topic_id: topicId }).toArray()
      docs.sort((a, b) => Number(a.page_number ?? 0) - Number(b.page_number ?? 0))
      return docs
    },
    { ttlMs: COURSE_TTL_MS, tags: [courseTag(courseId)] },
  )
  return [...pages]
}

/** Retrieve any topic by ID, cached. Invalidated when the course is invalidated. */
export async function getCachedTopicById(db: Db, topicId: string) {
  const cached = appCache.get<any>(`topic:id:${topicId}`)
  if (cached) return cached

  const topic = await db.collection('topics').findOne({ _id: topicId as any })
  if (topic) {
    const courseId = String(topic.course_id)
    appCache.set(`topic:id:${topicId}`, topic, COURSE_TTL_MS, [courseTag(courseId)])
  }
  return topic
}

/** Get course curriculum structure, cached. */
export async function getCachedCourseCurriculum(db: Db, courseId: string) {
  return appCache.getOrLoad(
    `course:curriculum:${courseId}`,
    () => db.collection('curricula').findOne(
      { course_id: courseId },
      { projection: { 'curriculum.branches.id': 1 } },
    ),
    { ttlMs: COURSE_TTL_MS, tags: [courseTag(courseId)] }
  )
}


