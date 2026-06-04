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

    const [topics, branches, topicEdges] = await Promise.all([
      db.collection('topics').find({ course_id: courseId }).sort({ position: 1 }).toArray(),
      db.collection('branches').find({ course_id: courseId }).toArray(),
      db.collection('topicEdges').find({ course_id: courseId }).toArray(),
    ])

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
    })

    return NextResponse.json(graphData)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    const status = message.includes('sign in') ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
