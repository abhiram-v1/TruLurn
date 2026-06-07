import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { transformToGraphData } from '@/lib/graph/transform'

export async function GET(
  _request: Request,
  { params }: { params: { courseId: string } },
) {
  try {
    const userId = await getRequiredUserId()
    const { courseId } = params
    const db = await getDb()

    const course = await db.collection('courses').findOne({ _id: courseId as any, user_id: userId })
    if (!course) {
      return NextResponse.json({ error: 'Course not found.' }, { status: 404 })
    }

    const [topics, branches, topicEdges, examSessions, doubtAgg] = await Promise.all([
      db.collection('topics').find({ course_id: courseId }).sort({ position: 1 }).toArray(),
      db.collection('branches').find({ course_id: courseId }).toArray(),
      db.collection('topicEdges').find({ course_id: courseId }).toArray(),
      // Most recent completed exam session per topic — for decay + false confidence
      db.collection('examSessions')
        .find({ course_id: courseId, user_id: userId, status: 'completed' })
        .sort({ completed_at: -1 })
        .project({ topic_id: 1, completed_at: 1, summary: 1 })
        .toArray(),
      // Doubt message count per topic
      db.collection('doubtMessages')
        .aggregate([
          { $match: { course_id: courseId, user_id: userId } },
          { $group: { _id: '$topic_id', count: { $sum: 1 } } },
        ])
        .toArray(),
    ])

    // Build lookup maps for the intelligence layer
    const lastExamByTopic = new Map<string, { completedAt: Date; falseConfidence: boolean }>()
    for (const session of examSessions) {
      const tid = String(session.topic_id)
      if (lastExamByTopic.has(tid)) continue // already have the most recent (sorted desc)
      const summary = session.summary as any
      const hasFalseConf = Boolean(
        summary?.passed &&
        Array.isArray(summary?.review_concepts) &&
        summary.review_concepts.length > 0 &&
        !summary.passed, // passed but flagged — check both flags
      ) || Boolean(
        session.summary &&
        typeof session.summary === 'object' &&
        (session.summary as any).false_confidence,
      )
      lastExamByTopic.set(tid, {
        completedAt: session.completed_at instanceof Date ? session.completed_at : new Date(session.completed_at ?? 0),
        falseConfidence: hasFalseConf,
      })
    }

    const doubtCountByTopic = new Map<string, number>()
    for (const row of doubtAgg) {
      doubtCountByTopic.set(String(row._id), Number(row.count ?? 0))
    }

    const graphTopics = topics.filter((topic) =>
      String(topic.node_type ?? '') !== 'container' && Number(topic.children_count ?? 0) <= 0,
    )
    const graphTopicIds = new Set(graphTopics.map((topic) => String(topic._id)))
    const graphEdges = topicEdges.filter((edge) => {
      if (String(edge.edge_type ?? 'semantic') === 'hierarchy') return false
      return graphTopicIds.has(String(edge.from_topic_id)) && graphTopicIds.has(String(edge.to_topic_id))
    })

    // Find the topic the user is currently studying (first active teachable one)
    const activeTopic = graphTopics.find((t) => t.state === 'active')
    const activeSingleTopicId = activeTopic ? String(activeTopic._id) : null

    const graphData = transformToGraphData({
      courseId,
      courseTitle: course.title ?? course.topic ?? 'Untitled',
      topics: graphTopics as any,
      branches: branches as any,
      topicEdges: graphEdges as any,
      activeSingleTopicId,
      lastExamByTopic,
      doubtCountByTopic,
    })

    return NextResponse.json(graphData)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    const status = message.includes('sign in') ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
