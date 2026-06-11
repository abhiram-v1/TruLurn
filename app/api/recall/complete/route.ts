import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { completeRecallSession, type RecallRating } from '@/lib/recall/generateRecallPage'
import { markBreakCompleted } from '@/lib/recall/session'

// POST /api/recall/complete
// Records self-ratings for a finished recall break, updates per-topic recall
// stats, and advances the study session's break watermark.
export async function POST(request: Request) {
  try {
    const userId = await getRequiredUserId()
    const body = await request.json()
    const recallSessionId = String(body.recallSessionId ?? '')
    const rawRatings = body.ratings && typeof body.ratings === 'object' ? body.ratings : {}

    if (!recallSessionId) {
      return NextResponse.json({ error: 'recallSessionId is required.' }, { status: 400 })
    }

    const ratings: Record<string, RecallRating> = {}
    for (const [itemId, rating] of Object.entries(rawRatings)) {
      if (['got_it', 'shaky', 'forgot'].includes(String(rating))) {
        ratings[String(itemId)] = String(rating) as RecallRating
      }
    }

    const db = await getDb()
    const completed = await completeRecallSession({ db, recallSessionId, userId, ratings })
    if (!completed) {
      return NextResponse.json({ error: 'Recall session not found.' }, { status: 404 })
    }

    await markBreakCompleted({ db, sessionId: completed.study_session_id, userId })

    return NextResponse.json({ ok: true, stats: completed.stats })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not complete the recall break.'
    const status = message.includes('sign in') ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
