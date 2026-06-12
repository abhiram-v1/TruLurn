import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import type { RecallItem, RecallSessionDoc } from '@/lib/recall/generateRecallPage'
import type { StudySessionDoc } from '@/lib/recall/session'
import { getRequiredUserId } from '@/lib/server/currentUser'

type TaggedReminderDoc = {
  _id: string
  user_id: string
  course_id: string
  recall_session_id: string
  recall_item_id: string
  prompt: string
  concept: string
  prompt_type: RecallItem['type']
  topic_id: string
  topic_title: string
  page_number: number | null
  tagged_at: Date
}

function serializeReminder(reminder: TaggedReminderDoc) {
  return {
    id: reminder._id,
    courseId: reminder.course_id,
    recallSessionId: reminder.recall_session_id,
    recallItemId: reminder.recall_item_id,
    prompt: reminder.prompt,
    concept: reminder.concept,
    type: reminder.prompt_type,
    topicId: reminder.topic_id,
    topicTitle: reminder.topic_title,
    pageNumber: reminder.page_number,
    taggedAt: reminder.tagged_at.toISOString(),
  }
}

async function findOwnedCourse(db: Awaited<ReturnType<typeof getDb>>, courseId: string, userId: string) {
  return db.collection('courses').findOne(
    { _id: courseId as any, user_id: userId },
    { projection: { _id: 1 } },
  )
}

export async function GET(request: Request) {
  try {
    const userId = await getRequiredUserId()
    const courseId = new URL(request.url).searchParams.get('courseId')?.trim() ?? ''
    if (!courseId) {
      return NextResponse.json({ error: 'courseId is required.' }, { status: 400 })
    }

    const db = await getDb()
    if (!await findOwnedCourse(db, courseId, userId)) {
      return NextResponse.json({ error: 'Course not found.' }, { status: 404 })
    }

    const reminders = await db.collection<TaggedReminderDoc>('taggedReminders')
      .find({ user_id: userId, course_id: courseId })
      .sort({ tagged_at: -1 })
      .limit(200)
      .toArray()

    return NextResponse.json({ reminders: reminders.map(serializeReminder) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load tagged reminders.'
    return NextResponse.json({ error: message }, { status: message.includes('sign in') ? 401 : 500 })
  }
}

export async function POST(request: Request) {
  try {
    const userId = await getRequiredUserId()
    const body = await request.json()
    const recallSessionId = String(body.recallSessionId ?? '').trim()
    const recallItemId = String(body.itemId ?? '').trim()
    if (!recallSessionId || !recallItemId) {
      return NextResponse.json({ error: 'recallSessionId and itemId are required.' }, { status: 400 })
    }

    const db = await getDb()
    const session = await db.collection<RecallSessionDoc>('recallSessions').findOne({
      _id: recallSessionId as any,
      user_id: userId,
    })
    if (!session || !await findOwnedCourse(db, session.course_id, userId)) {
      return NextResponse.json({ error: 'Recall prompt not found.' }, { status: 404 })
    }

    const item = session.items.find((candidate) => candidate.id === recallItemId)
    if (!item?.prompt) {
      return NextResponse.json({ error: 'Recall prompt not found.' }, { status: 404 })
    }

    const studySession = await db.collection<StudySessionDoc>('studySessions').findOne(
      { _id: session.study_session_id as any, user_id: userId, course_id: session.course_id },
      { projection: { pages: 1 } },
    )
    const fallbackPage = studySession?.pages.at(-1) ?? null
    const sourceTopicId = item.topic_id || fallbackPage?.topic_id || null
    if (!sourceTopicId) {
      return NextResponse.json({ error: 'This prompt has no source topic to revisit.' }, { status: 422 })
    }

    const topic = await db.collection('topics').findOne(
      { _id: sourceTopicId as any, course_id: session.course_id },
      { projection: { title: 1 } },
    )
    if (!topic) {
      return NextResponse.json({ error: 'The source topic is no longer available.' }, { status: 404 })
    }

    let pageNumber = item.page_number ?? null
    if (!pageNumber) {
      pageNumber = studySession?.pages
        .filter((page) => page.topic_id === sourceTopicId)
        .at(-1)?.page_number ?? null
    }

    const existing = await db.collection<TaggedReminderDoc>('taggedReminders').findOne({
      user_id: userId,
      course_id: session.course_id,
      recall_session_id: session._id,
      recall_item_id: item.id,
    })
    if (existing) {
      return NextResponse.json({ reminder: serializeReminder(existing), alreadyTagged: true })
    }

    const reminder: TaggedReminderDoc = {
      _id: crypto.randomUUID(),
      user_id: userId,
      course_id: session.course_id,
      recall_session_id: session._id,
      recall_item_id: item.id,
      prompt: item.prompt,
      concept: item.concept,
      prompt_type: item.type,
      topic_id: sourceTopicId,
      topic_title: (item.topic_id ? item.topic_title : fallbackPage?.topic_title)
        || String(topic.title ?? 'Lesson topic'),
      page_number: pageNumber,
      tagged_at: new Date(),
    }

    await db.collection<TaggedReminderDoc>('taggedReminders').insertOne(reminder)
    return NextResponse.json({ reminder: serializeReminder(reminder), alreadyTagged: false }, { status: 201 })
  } catch (error: any) {
    if (error?.code === 11000) {
      return NextResponse.json({ ok: true, alreadyTagged: true })
    }
    const message = error instanceof Error ? error.message : 'Could not tag this reminder.'
    return NextResponse.json({ error: message }, { status: message.includes('sign in') ? 401 : 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await getRequiredUserId()
    const url = new URL(request.url)
    const courseId = url.searchParams.get('courseId')?.trim() ?? ''
    const reminderId = url.searchParams.get('reminderId')?.trim() ?? ''
    if (!courseId || !reminderId) {
      return NextResponse.json({ error: 'courseId and reminderId are required.' }, { status: 400 })
    }

    const db = await getDb()
    if (!await findOwnedCourse(db, courseId, userId)) {
      return NextResponse.json({ error: 'Course not found.' }, { status: 404 })
    }

    const result = await db.collection('taggedReminders').deleteOne({
      _id: reminderId as any,
      user_id: userId,
      course_id: courseId,
    })
    if (!result.deletedCount) {
      return NextResponse.json({ error: 'Tagged reminder not found.' }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not remove the tagged reminder.'
    return NextResponse.json({ error: message }, { status: message.includes('sign in') ? 401 : 500 })
  }
}
