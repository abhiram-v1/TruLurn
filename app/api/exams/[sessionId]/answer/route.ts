import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { answerExamTurn } from '@/lib/quiz/examEngine'

export async function POST(
  request: Request,
  { params }: { params: { sessionId: string } },
) {
  try {
    const body = await request.json()
    const turnId = String(body.turnId ?? '')
    const answer = String(body.answer ?? '')

    if (!turnId) {
      return NextResponse.json({ error: 'Missing turnId.' }, { status: 400 })
    }
    if (!answer.trim()) {
      return NextResponse.json({ error: 'Write an answer before continuing.' }, { status: 400 })
    }
    if (answer.length > 10000) {
      return NextResponse.json({ error: 'Answer is too long (max 10,000 characters).' }, { status: 400 })
    }

    const db = await getDb()
    const userId = await getRequiredUserId()
    const state = await answerExamTurn({
      db,
      sessionId: decodeURIComponent(params.sessionId),
      turnId,
      answer,
      userId,
    })
    return NextResponse.json(state)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not submit answer.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
