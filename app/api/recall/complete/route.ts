import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { completeRecallSession } from '@/lib/recall/generateRecallPage'
import { markBreakCompleted } from '@/lib/recall/session'

// POST /api/recall/complete
// Marks prompt-only review as completed and advances the study-session watermark.
export async function POST(request: Request) {
  try {
    const userId = await getRequiredUserId()
    const body = await request.json()
    const recallSessionId = String(body.recallSessionId ?? '')
    const reviewedItemIds = Array.isArray(body.reviewedItemIds)
      ? body.reviewedItemIds.map(String)
      : []

    if (!recallSessionId) {
      return NextResponse.json({ error: 'recallSessionId is required.' }, { status: 400 })
    }

    const db = await getDb()
    const completed = await completeRecallSession({ db, recallSessionId, userId, reviewedItemIds })
    if (!completed) {
      return NextResponse.json({ error: 'Recall session not found.' }, { status: 404 })
    }

    await markBreakCompleted({ db, sessionId: completed.study_session_id, userId })

    return NextResponse.json({ ok: true, reviewed: completed.reviewed_item_ids?.length ?? 0 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not complete the recall break.'
    const status = message.includes('sign in') ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
