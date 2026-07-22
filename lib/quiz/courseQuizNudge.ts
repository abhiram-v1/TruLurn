import type { Db } from 'mongodb'
import { isContainerTopic } from '@/lib/traccia/sequence'

const COMPLETE_STATES = new Set(['mastered', 'functional', 'done'])

type TopicLike = {
  _id: unknown
  title?: string
  state?: string
  node_type?: string
  children_count?: number
  position?: number
  sequence_index?: number
}

export type QuizNudge = {
  /** Completed topics in this course with no quiz attempt yet. */
  unquizzedCount: number
  /** Most recently completed unquizzed topic — the one the nudge points to. */
  topicId: string
  topicTitle: string
}

/**
 * Balanced-mode nudge: once the learner has finished topics without ever
 * checking their understanding, point them at the most recent one. Guided
 * courses gate on quizzes elsewhere; open courses are left alone entirely —
 * callers should only invoke this for 'balanced' courses.
 */
export async function computeQuizNudge(
  db: Db,
  userId: string,
  courseId: string,
  topics: TopicLike[],
): Promise<QuizNudge | null> {
  const completed = topics.filter(
    (topic) => !isContainerTopic(topic) && COMPLETE_STATES.has(String(topic.state)),
  )
  if (!completed.length) return null

  const attemptedTopicIds = await db.collection('quizAttempts').distinct('topic_id', {
    user_id: userId,
    course_id: courseId,
  })
  const attemptedSet = new Set(attemptedTopicIds.map(String))

  const unquizzed = completed.filter((topic) => !attemptedSet.has(String(topic._id)))
  if (!unquizzed.length) return null

  const [target] = [...unquizzed].sort((a, b) => {
    const aOrder = Number(a.sequence_index ?? a.position ?? 0)
    const bOrder = Number(b.sequence_index ?? b.position ?? 0)
    return bOrder - aOrder
  })

  return {
    unquizzedCount: unquizzed.length,
    topicId: String(target._id),
    topicTitle: String(target.title ?? 'this topic'),
  }
}
