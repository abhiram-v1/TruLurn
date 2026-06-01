import type { Db } from 'mongodb'

export async function getConceptMap(db: Db, courseId: string): Promise<string[]> {
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

  return [...new Set(concepts)]
}
