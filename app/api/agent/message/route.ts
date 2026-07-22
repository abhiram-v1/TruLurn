export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { handleMessage } from '@/lib/agent/handleMessage'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { getCachedCourseTopics } from '@/lib/cache/courseData'
import { generateConversationTitle } from '@/lib/chat/generateConversationTitle'
import { apiUsageErrorResponse, consumeApiUsage } from '@/lib/server/apiUsage'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const courseId = searchParams.get('courseId')
    if (!courseId) {
      return NextResponse.json({ error: 'Missing courseId parameter.' }, { status: 400 })
    }
    const conversationId = searchParams.get('conversationId')

    const [db, userId] = await Promise.all([getDb(), getRequiredUserId()])

    const course = await db.collection('courses').findOne(
      { _id: courseId as any, user_id: userId },
      { projection: { _id: 1 } },
    )
    if (!course) {
      return NextResponse.json({ error: 'Course not found.' }, { status: 404 })
    }

    // Messages are grouped into saved chat threads (conversation_id). Older
    // messages predate that grouping and have no conversation_id at all —
    // they surface under the synthetic "legacy" thread.
    const conversationFilter = !conversationId || conversationId === 'legacy'
      ? { conversation_id: { $exists: false } }
      : { conversation_id: conversationId }

    const messages = await db.collection('doubtMessages')
      .find({ course_id: courseId, user_id: userId, ...conversationFilter })
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

// Bumps recency on every message; on the first message of a thread, names it
// from the exchange (question + answer) the way ChatGPT/Claude auto-title a
// new conversation. Later messages just touch updated_at — no repeat AI call.
async function touchConversation(
  db: any,
  userId: string,
  conversationId: string,
  question: string,
  answer: string,
) {
  const conversation = await db.collection('chatConversations').findOne({ _id: conversationId, user_id: userId })
  if (!conversation) return

  if (conversation.title) {
    await db.collection('chatConversations').updateOne(
      { _id: conversationId },
      { $set: { updated_at: new Date() } },
    )
    return
  }

  const title = await generateConversationTitle(question, answer)
  await db.collection('chatConversations').updateOne(
    { _id: conversationId },
    { $set: { title, updated_at: new Date() } },
  )
}

export async function POST(request: Request) {
  const startedAt = performance.now()
  try {
    const userId = await getRequiredUserId()
    const body = await request.json()
    const { courseId, topicId, pageNumber, message, selectedContext, stream, conversationId } = body

    if (!courseId || !topicId || pageNumber === undefined || !message?.trim()) {
      return NextResponse.json({ error: 'Missing required agent parameters.' }, { status: 400 })
    }
    if (String(message).trim().length > 4000) {
      return NextResponse.json({ error: 'Message must be 4,000 characters or fewer.' }, { status: 400 })
    }
    if (typeof selectedContext === 'string' && selectedContext.length > 6000) {
      return NextResponse.json({ error: 'Selected context must be 6,000 characters or fewer.' }, { status: 400 })
    }
    if (!Number.isFinite(Number(pageNumber)) || Number(pageNumber) < 1) {
      return NextResponse.json({ error: 'pageNumber must be a positive number.' }, { status: 400 })
    }

    const db = await getDb()
    const [course, topic] = await Promise.all([
      db.collection('courses').findOne(
        { _id: String(courseId) as any, user_id: userId },
        { projection: { _id: 1 } },
      ),
      db.collection('topics').findOne(
        { _id: String(topicId) as any, course_id: String(courseId) },
        { projection: { _id: 1 } },
      ),
    ])
    if (!course || !topic) {
      return NextResponse.json({ error: 'Course or topic not found.' }, { status: 404 })
    }
    await consumeApiUsage({ userId, bucket: 'tutor_messages', scope: 'tutor', db })
    const contextReadyAt = performance.now()
    const input = {
      db,
      userId,
      courseId,
      topicId,
      pageNumber: Number(pageNumber),
      message,
      selectedContext: typeof selectedContext === 'string' ? selectedContext : null,
      conversationId: typeof conversationId === 'string' && conversationId !== 'legacy' ? conversationId : null,
      signal: request.signal,
    }

    if (stream === true) {
      const encoder = new TextEncoder()
      const eventStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (payload: Record<string, unknown>) => {
            if (!request.signal.aborted) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
            }
          }
          try {
            send({ type: 'status', message: 'Thinking…' })
            const result = await handleMessage({
              ...input,
              onDelta: (delta) => send({ type: 'delta', delta }),
            })
            if (input.conversationId) {
              void touchConversation(db, userId, input.conversationId, message, result.content).catch((error) => {
                console.warn('[agent/message] Failed to touch conversation.', error)
              })
            }
            send({ type: 'done', ...result })
          } catch (error) {
            if (!request.signal.aborted) {
              send({ type: 'error', error: error instanceof Error ? error.message : 'Agent failed to respond.' })
            }
          } finally {
            controller.close()
          }
        },
      })

      return new Response(eventStream, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      })
    }

    const result = await handleMessage(input)

    if (input.conversationId) {
      void touchConversation(db, userId, input.conversationId, message, result.content).catch((error) => {
        console.warn('[agent/message] Failed to touch conversation.', error)
      })
    }

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
    const limited = apiUsageErrorResponse(error)
    if (limited) return limited
    const message = error instanceof Error ? error.message : 'Unknown agent error'
    const status = message.includes('sign in') ? 401 : message.includes('not found') ? 404 : 500

    return NextResponse.json({ error: message }, { status })
  }
}
