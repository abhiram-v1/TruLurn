export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { handleDoubt } from '@/lib/doubts/handleDoubt'
import { getRequiredUserId } from '@/lib/server/currentUser'

export async function POST(request: Request) {
  const startedAt = performance.now()
  try {
    const body = await request.json()
    const { courseId, topicId, pageNumber, question } = body

    if (!courseId || !topicId || pageNumber === undefined || !question?.trim()) {
      return NextResponse.json({ error: 'Missing required chat parameters.' }, { status: 400 })
    }

    const parsedPageNumber = Number(pageNumber)
    if (!Number.isFinite(parsedPageNumber) || parsedPageNumber < 1) {
      return NextResponse.json({ error: 'pageNumber must be a positive number.' }, { status: 400 })
    }

    // Cap question length: protects the prompt budget and bounds per-call cost.
    const trimmedQuestion = String(question).trim().slice(0, 4000)

    const [db, userId] = await Promise.all([getDb(), getRequiredUserId()])
    const contextReadyAt = performance.now()
    const result = await handleDoubt({
      db,
      userId,
      courseId,
      topicId,
      pageNumber: parsedPageNumber,
      question: trimmedQuestion,
    })

    const completedAt = performance.now()
    return NextResponse.json(result, {
      headers: {
        'Server-Timing': [
          `context;dur=${(contextReadyAt - startedAt).toFixed(1)}`,
          `answer;dur=${(completedAt - contextReadyAt).toFixed(1)}`,
          `total;dur=${(completedAt - startedAt).toFixed(1)}`,
        ].join(', '),
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown doubt chat error'
    const status = message.includes('sign in') ? 401 : message.includes('not found') ? 404 : 500

    return NextResponse.json({ error: message }, { status })
  }
}
