import type { Db } from 'mongodb'

// Module-level TTL cache — concept maps change only when new pages are generated,
// not between chat messages. Warm instances reuse the cached value for 2 minutes,
// eliminating 3 DB reads per doubt message on hot paths.
const cache = new Map<string, { concepts: string[]; expiresAt: number }>()
const TTL_MS = 2 * 60 * 1000

export async function getConceptMap(db: Db, courseId: string): Promise<string[]> {
  const hit = cache.get(courseId)
  if (hit && hit.expiresAt > Date.now()) return hit.concepts

  const [topics, topicSummaries, pageSummaries] = await Promise.all([
    db.collection('topics')
      .find({ course_id: courseId })
      .project({ key_concepts: 1, title: 1 })
      .toArray(),
    db.collection('topicSummaries')
      .find({ course_id: courseId })
      .project({ key_concepts: 1, title: 1 })
      .toArray(),
    db.collection('pageSummaries')
      .find({ course_id: courseId })
      .project({ key_concepts: 1 })
      .toArray(),
  ])

  const concepts = [
    ...topics.flatMap((topic) => [topic.title, ...(topic.key_concepts ?? [])]),
    ...topicSummaries.flatMap((summary) => [summary.title, ...(summary.key_concepts ?? [])]),
    ...pageSummaries.flatMap((summary) => summary.key_concepts ?? []),
  ]
    .filter((concept): concept is string => typeof concept === 'string' && concept.trim().length > 2)
    .map((concept) => concept.trim())

  const result = [...new Set(concepts)]
  cache.set(courseId, { concepts: result, expiresAt: Date.now() + TTL_MS })
  return result
}

export function invalidateConceptMapCache(courseId: string) {
  cache.delete(courseId)
}
