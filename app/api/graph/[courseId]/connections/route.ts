import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'

// Learner-created knowledge connections — the edges of the personal graph.
// POST   /api/graph/[courseId]/connections   { fromTopicId, toTopicId, note? }
// DELETE /api/graph/[courseId]/connections?id=<connectionId>

export async function POST(
  request: Request,
  { params }: { params: { courseId: string } },
) {
  try {
    const userId = await getRequiredUserId()
    const courseId = params.courseId
    const body = await request.json()
    const fromTopicId = String(body.fromTopicId ?? '')
    const toTopicId = String(body.toTopicId ?? '')
    const note = String(body.note ?? '').trim().slice(0, 280) || null

    if (!fromTopicId || !toTopicId || fromTopicId === toTopicId) {
      return NextResponse.json({ error: 'Two different concepts are required.' }, { status: 400 })
    }

    const db = await getDb()
    const course = await db.collection('courses').findOne(
      { _id: courseId as any, user_id: userId },
      { projection: { _id: 1 } },
    )
    if (!course) {
      return NextResponse.json({ error: 'Course not found.' }, { status: 404 })
    }

    const topicCount = await db.collection('topics').countDocuments({
      _id: { $in: [fromTopicId, toTopicId] as any[] },
      course_id: courseId,
    })
    if (topicCount !== 2) {
      return NextResponse.json({ error: 'Both concepts must belong to this course.' }, { status: 400 })
    }

    // One connection per unordered pair: store the pair in canonical order.
    const [a, b] = [fromTopicId, toTopicId].sort()
    const existing = await db.collection('userConnections').findOne({
      user_id: userId,
      course_id: courseId,
      from_topic_id: a,
      to_topic_id: b,
    })
    if (existing) {
      // Re-connecting an existing pair updates the note instead of erroring.
      if (note && note !== existing.note) {
        await db.collection('userConnections').updateOne(
          { _id: existing._id },
          { $set: { note, updated_at: new Date() } },
        )
      }
      return NextResponse.json({ id: String(existing._id), alreadyExists: true })
    }

    const id = crypto.randomUUID()
    await db.collection('userConnections').insertOne({
      _id: id as any,
      user_id: userId,
      course_id: courseId,
      from_topic_id: a,
      to_topic_id: b,
      note,
      created_at: new Date(),
      updated_at: new Date(),
    })

    return NextResponse.json({ id })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not create the connection.'
    const status = message.includes('sign in') ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { courseId: string } },
) {
  try {
    const userId = await getRequiredUserId()
    const url = new URL(request.url)
    const connectionId = url.searchParams.get('id')

    if (!connectionId) {
      return NextResponse.json({ error: 'Connection id is required.' }, { status: 400 })
    }

    const db = await getDb()
    const result = await db.collection('userConnections').deleteOne({
      _id: connectionId as any,
      user_id: userId,
      course_id: params.courseId,
    })

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: 'Connection not found.' }, { status: 404 })
    }
    return NextResponse.json({ deleted: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not delete the connection.'
    const status = message.includes('sign in') ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
