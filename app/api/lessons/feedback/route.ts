import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { syncLearnerMemoryV2 } from '@/lib/memory/service'

// Micro-feedback signals from the bottom of each lesson page.
// got_it      → current level is right (neutral)
// lost_me     → too hard; shift future pages of this topic toward beginner
// too_basic   → too easy; shift future pages of this topic toward expert
const SIGNALS = ['got_it', 'lost_me', 'too_basic'] as const
type Signal = (typeof SIGNALS)[number]

const SHIFT_BY_SIGNAL: Record<Signal, number> = {
  got_it: 0,
  lost_me: -1,
  too_basic: 1,
}

// Optional short reason chips shown after a negative signal. Free text
// ("other") is capped so this stays a quick tap, not a form.
const MAX_NOTE_LENGTH = 300

export async function POST(request: Request) {
  try {
    const userId = await getRequiredUserId()
    const body = await request.json()
    const courseId = String(body.courseId ?? '')
    const topicId = String(body.topicId ?? '')
    const pageNumber = Number(body.pageNumber ?? 0)
    const signal = String(body.signal ?? '') as Signal
    const reason = body.reason != null ? String(body.reason).slice(0, 80) : undefined
    const note = body.note != null ? String(body.note).slice(0, MAX_NOTE_LENGTH) : undefined

    if (!courseId || !topicId || !SIGNALS.includes(signal)) {
      return NextResponse.json({ error: 'Missing or invalid feedback parameters.' }, { status: 400 })
    }

    const db = await getDb()

    // Verify the course belongs to this user before recording anything.
    const course = await db.collection('courses').findOne(
      { _id: courseId as any, user_id: userId },
      { projection: { _id: 1 } },
    )
    if (!course) {
      return NextResponse.json({ error: 'Course not found.' }, { status: 404 })
    }

    const now = new Date()

    // Record the raw event (one per page click; upsert so re-clicking updates).
    // The reason/note may arrive on this same call or a follow-up call once
    // the student picks why — either way it merges onto the same document.
    // Reasons are also copied to the topic below so the next page writer can
    // change teaching strategy without another feedback lookup.
    const setFields: Record<string, unknown> = { signal, updated_at: now }
    if (reason !== undefined) setFields.reason = reason
    if (note !== undefined) setFields.note = note

    await db.collection('lessonFeedback').updateOne(
      { user_id: userId, course_id: courseId, topic_id: topicId, page_number: pageNumber },
      {
        $set: setFields,
        $setOnInsert: { _id: crypto.randomUUID() as any, created_at: now },
      },
      { upsert: true },
    )

    // Derive a level shift for future page generation of this topic. The most
    // recent signal wins — it reflects how the student feels right now.
    const shift = SHIFT_BY_SIGNAL[signal]
    const topicFeedback: Record<string, unknown> = {
      feedback_level_shift: shift,
      feedback_last_signal: signal,
      feedback_last_at: now,
      updated_at: now,
    }
    if (reason !== undefined) topicFeedback.feedback_last_reason = reason
    if (note !== undefined) topicFeedback.feedback_last_note = note

    const topicUpdate: Record<string, unknown> = { $set: topicFeedback }
    if (reason === undefined && note === undefined) {
      topicUpdate.$unset = { feedback_last_reason: '', feedback_last_note: '' }
    }

    await db.collection('topics').updateOne(
      { _id: topicId as any, course_id: courseId },
      topicUpdate,
    )
    await syncLearnerMemoryV2({ db, userId, courseId, force: true }).catch((error) => {
      console.warn('[lessonFeedback] Memory V2 sync failed.', error)
    })
    await db.collection('learnerProfiles').deleteOne({ user_id: userId, course_id: courseId })

    return NextResponse.json({ ok: true, signal })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not record feedback.'
    const status = message.includes('sign in') ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
