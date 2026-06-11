import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { createRecallSession, type RecallSessionDoc } from '@/lib/recall/generateRecallPage'
import { getRecallBreakMode, snoozeBreak, type StudySessionDoc } from '@/lib/recall/session'

function serializeRecallSession(doc: RecallSessionDoc) {
  return {
    id: doc._id,
    headline: doc.headline,
    summaries: doc.summaries,
    items: doc.items.map((item) => ({
      id: item.id,
      type: item.type,
      concept: item.concept,
      prompt: item.prompt,
      answer: item.answer,
    })),
  }
}

// POST /api/recall/break
// action: "start"  → generate (or resume) the recall page for the current stretch
// action: "snooze" → suppress the break prompt for ~5 minutes
export async function POST(request: Request) {
  try {
    const userId = await getRequiredUserId()
    const body = await request.json()
    const courseId = String(body.courseId ?? '')
    const action = String(body.action ?? 'start')

    if (!courseId) {
      return NextResponse.json({ error: 'courseId is required.' }, { status: 400 })
    }

    const db = await getDb()
    const course = await db.collection('courses').findOne(
      { _id: courseId as any, user_id: userId },
      { projection: { title: 1, topic: 1 } },
    )
    if (!course) {
      return NextResponse.json({ error: 'Course not found.' }, { status: 404 })
    }

    const session = await db.collection<StudySessionDoc>('studySessions').findOne({
      user_id: userId,
      course_id: courseId,
      status: 'active',
    })
    if (!session) {
      return NextResponse.json({ error: 'No active study session for this course yet.' }, { status: 404 })
    }

    if (action === 'snooze') {
      await snoozeBreak({ db, sessionId: session._id, userId })
      return NextResponse.json({ snoozed: true })
    }

    const mode = await getRecallBreakMode(db, userId)
    const trigger: RecallSessionDoc['trigger'] = body.manual ? 'manual' : mode === 'off' ? 'manual' : mode

    const recallSession = await createRecallSession({
      db,
      session,
      courseTitle: String(course.title ?? course.topic ?? 'Course'),
      trigger,
    })

    return NextResponse.json({ recall: serializeRecallSession(recallSession) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not start the recall break.'
    const status = message.includes('sign in') ? 401 : message.includes('Nothing new') ? 409 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
