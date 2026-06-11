import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import {
  evaluateBreakDue,
  getRecallBreakMode,
  trackStudyActivity,
  type TrackEvent,
} from '@/lib/recall/session'

// POST /api/recall/track
// Cheap activity heartbeat from the learn UI (no AI calls). Records study
// activity into the active session and answers one question: is a recall
// break due right now?
export async function POST(request: Request) {
  try {
    const userId = await getRequiredUserId()
    const body = await request.json()
    const courseId = String(body.courseId ?? '')
    const type = String(body.event ?? 'heartbeat') as TrackEvent['type']

    if (!courseId || !['heartbeat', 'page_view', 'question_answered'].includes(type)) {
      return NextResponse.json({ error: 'Missing or invalid tracking parameters.' }, { status: 400 })
    }

    const db = await getDb()
    const course = await db.collection('courses').findOne(
      { _id: courseId as any, user_id: userId },
      { projection: { _id: 1 } },
    )
    if (!course) {
      return NextResponse.json({ error: 'Course not found.' }, { status: 404 })
    }

    const event: TrackEvent = {
      type,
      topicId: body.topicId ? String(body.topicId) : undefined,
      topicTitle: body.topicTitle ? String(body.topicTitle) : undefined,
      pageNumber: Number.isFinite(Number(body.pageNumber)) ? Number(body.pageNumber) : undefined,
      keyConcepts: Array.isArray(body.keyConcepts) ? body.keyConcepts.map(String) : undefined,
      summary: body.summary ? String(body.summary) : null,
    }

    const [session, mode] = await Promise.all([
      trackStudyActivity({ db, userId, courseId, event }),
      getRecallBreakMode(db, userId),
    ])

    const decision = evaluateBreakDue(session, mode)

    return NextResponse.json({
      sessionId: session._id,
      mode,
      breakDue: decision.due,
      reason: decision.reason,
      newPages: decision.newPages,
      newConcepts: decision.newConcepts,
      minutesSinceBreak: Math.round(decision.minutesSinceBreak),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not track study activity.'
    const status = message.includes('sign in') ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
