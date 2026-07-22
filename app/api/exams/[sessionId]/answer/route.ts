import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { answerExamTurn, saveExamDraft } from '@/lib/quiz/examEngine'
import { apiUsageErrorResponse, consumeApiUsage } from '@/lib/server/apiUsage'

export async function POST(
  request: Request,
  { params }: { params: { sessionId: string } },
) {
  try {
    const body = await request.json()
    const turnId = String(body.turnId ?? '')
    const uncertain = Boolean(body.uncertain)
    const answer = uncertain ? 'I’m not sure yet.' : String(body.answer ?? '')

    if (!turnId) {
      return NextResponse.json({ error: 'Missing turnId.' }, { status: 400 })
    }
    if (!uncertain && !answer.trim()) {
      return NextResponse.json({ error: 'Write an answer before continuing.' }, { status: 400 })
    }
    if (answer.length > 10000) {
      return NextResponse.json({ error: 'Answer is too long (max 10,000 characters).' }, { status: 400 })
    }

    const db = await getDb()
    const userId = await getRequiredUserId()
    await consumeApiUsage({ userId, bucket: 'quiz_actions', scope: 'quiz', db })
    const state = await answerExamTurn({
      db,
      sessionId: decodeURIComponent(params.sessionId),
      turnId,
      answer,
      uncertain,
      userId,
    })
    return NextResponse.json(state)
  } catch (error) {
    const limited = apiUsageErrorResponse(error)
    if (limited) return limited
    const message = error instanceof Error ? error.message : 'Could not submit answer.'
    const status = message.toLowerCase().includes('sign in') ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export async function PUT(
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
    if (answer.length > 10000) {
      return NextResponse.json({ error: 'Draft is too long (max 10,000 characters).' }, { status: 400 })
    }

    const db = await getDb()
    const userId = await getRequiredUserId()
    await saveExamDraft({
      db,
      sessionId: decodeURIComponent(params.sessionId),
      turnId,
      answer,
      userId,
    })
    return NextResponse.json({ saved: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save quiz draft.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
