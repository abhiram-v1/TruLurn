import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { getExamState } from '@/lib/quiz/examEngine'

export async function GET(
  _request: Request,
  { params }: { params: { sessionId: string } },
) {
  try {
    const db = await getDb()
    const userId = await getRequiredUserId()
    const state = await getExamState(db, decodeURIComponent(params.sessionId), userId)
    return NextResponse.json(state)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load exam.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
