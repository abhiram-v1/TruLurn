export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { handleMessage } from '@/lib/agent/handleMessage'
import { getRequiredUserId } from '@/lib/server/currentUser'

export async function POST(request: Request) {
  const startedAt = performance.now()
  try {
    const body = await request.json()
    const { courseId, topicId, pageNumber, message, selectedContext } = body

    if (!courseId || !topicId || pageNumber === undefined || !message?.trim()) {
      return NextResponse.json({ error: 'Missing required agent parameters.' }, { status: 400 })
    }

    const [db, userId] = await Promise.all([getDb(), getRequiredUserId()])
    const contextReadyAt = performance.now()
    const result = await handleMessage({
      db,
      userId,
      courseId,
      topicId,
      pageNumber: Number(pageNumber),
      message,
      selectedContext: typeof selectedContext === 'string' ? selectedContext : null,
    })

    const completedAt = performance.now()
    return NextResponse.json(result, {
      headers: {
        'Server-Timing': [
          `context;dur=${(contextReadyAt - startedAt).toFixed(1)}`,
          `agent;dur=${(completedAt - contextReadyAt).toFixed(1)}`,
          `total;dur=${(completedAt - startedAt).toFixed(1)}`,
        ].join(', '),
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown agent error'
    const status = message.includes('sign in') ? 401 : message.includes('not found') ? 404 : 500

    return NextResponse.json({ error: message }, { status })
  }
}
