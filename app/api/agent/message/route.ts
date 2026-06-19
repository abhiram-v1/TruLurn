export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { handleMessage } from '@/lib/agent/handleMessage'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { getCachedCourseTopics } from '@/lib/cache/courseData'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const courseId = searchParams.get('courseId')
    if (!courseId) {
      return NextResponse.json({ error: 'Missing courseId parameter.' }, { status: 400 })
    }

    const [db, userId] = await Promise.all([getDb(), getRequiredUserId()])
    
    // Fetch doubt messages from MongoDB (indexed on user_id, course_id, created_at)
    const messages = await db.collection('doubtMessages')
      .find({ course_id: courseId, user_id: userId })
      .sort({ created_at: -1 })
      .limit(50)
      .toArray()

    // Fetch course topics from cache to resolve topic titles
    const courseTopics = await getCachedCourseTopics(db, courseId).catch(() => [])
    const messageTopicTitleById = new Map(
      courseTopics.map((t) => [String(t._id), t.title]),
    )

    const serializedMessages = messages.reverse().map((m) => ({
      id: String(m._id),
      topic_id: String(m.topic_id),
      page_number: m.page_number,
      topic_title: messageTopicTitleById.get(String(m.topic_id)) ?? null,
      role: m.role,
      content: m.content,
      source_citations: Array.isArray(m.source_citations) ? m.source_citations : undefined,
      grounding: m.grounding ?? null,
      created_at: m.created_at.toISOString(),
    }))

    return NextResponse.json({ messages: serializedMessages })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown agent GET error'
    const status = message.includes('sign in') ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export async function POST(request: Request) {
  const startedAt = performance.now()
  try {
    const body = await request.json()
    const { courseId, topicId, pageNumber, message, selectedContext } = body

    if (!courseId || !topicId || pageNumber === undefined || !message?.trim()) {
      return NextResponse.json({ error: 'Missing required agent parameters.' }, { status: 400 })
    }

    const [db, userId] = await Promise.all([getDb(), getRequiredUserId()])
    const contextReadyAt = performance.now()
    const result = await handleMessage({
      db,
      userId,
      courseId,
      topicId,
      pageNumber: Number(pageNumber),
      message,
      selectedContext: typeof selectedContext === 'string' ? selectedContext : null,
    })

    const completedAt = performance.now()
    return NextResponse.json(result, {
      headers: {
        'Server-Timing': [
          `context;dur=${(contextReadyAt - startedAt).toFixed(1)}`,
          `agent;dur=${(completedAt - contextReadyAt).toFixed(1)}`,
          `total;dur=${(completedAt - startedAt).toFixed(1)}`,
        ].join(', '),
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown agent error'
    const status = message.includes('sign in') ? 401 : message.includes('not found') ? 404 : 500

    return NextResponse.json({ error: message }, { status })
  }
}
