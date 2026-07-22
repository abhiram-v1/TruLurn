export const dynamic = 'force-dynamic'

import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'

const LEGACY_CONVERSATION_ID = 'legacy'

function serializeConversation(doc: any) {
  return {
    id: String(doc._id),
    title: doc.title ? String(doc.title) : null,
    createdAt: doc.created_at.toISOString(),
    updatedAt: doc.updated_at.toISOString(),
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const courseId = searchParams.get('courseId')
    if (!courseId) {
      return NextResponse.json({ error: 'Missing courseId parameter.' }, { status: 400 })
    }

    const [db, userId] = await Promise.all([getDb(), getRequiredUserId()])

    const [conversations, legacyLatest] = await Promise.all([
      db.collection('chatConversations')
        .find({ course_id: courseId, user_id: userId, deleted_at: null })
        .sort({ updated_at: -1 })
        .limit(100)
        .toArray(),
      db.collection('doubtMessages').findOne(
        { course_id: courseId, user_id: userId, conversation_id: { $exists: false } },
        { sort: { created_at: -1 }, projection: { created_at: 1 } },
      ),
    ])

    const serialized = conversations.map(serializeConversation)
    if (legacyLatest) {
      serialized.push({
        id: LEGACY_CONVERSATION_ID,
        title: 'Earlier messages',
        createdAt: legacyLatest.created_at.toISOString(),
        updatedAt: legacyLatest.created_at.toISOString(),
      })
    }

    return NextResponse.json({ conversations: serialized })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown conversations GET error'
    const status = message.includes('sign in') ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const courseId = String(body.courseId ?? '')
    if (!courseId) {
      return NextResponse.json({ error: 'Missing courseId.' }, { status: 400 })
    }

    const [db, userId] = await Promise.all([getDb(), getRequiredUserId()])
    const now = new Date()
    const doc = {
      _id: crypto.randomUUID() as any,
      course_id: courseId,
      user_id: userId,
      title: null as string | null,
      created_at: now,
      updated_at: now,
      deleted_at: null as Date | null,
    }
    await db.collection('chatConversations').insertOne(doc)

    return NextResponse.json({ conversation: serializeConversation(doc) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown conversations POST error'
    const status = message.includes('sign in') ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const conversationId = searchParams.get('conversationId')
    if (!conversationId || conversationId === LEGACY_CONVERSATION_ID) {
      return NextResponse.json({ error: 'Missing or invalid conversationId.' }, { status: 400 })
    }

    const [db, userId] = await Promise.all([getDb(), getRequiredUserId()])
    const result = await db.collection('chatConversations').updateOne(
      { _id: conversationId as any, user_id: userId, deleted_at: null },
      { $set: { deleted_at: new Date() } },
    )
    if (result.matchedCount === 0) {
      return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown conversations DELETE error'
    const status = message.includes('sign in') ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
