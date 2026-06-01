import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { handleDoubt } from '@/lib/doubts/handleDoubt'
import { getRequiredUserId } from '@/lib/server/currentUser'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { courseId, topicId, pageNumber, question } = body

    if (!courseId || !topicId || pageNumber === undefined || !question?.trim()) {
      return NextResponse.json({ error: 'Missing required chat parameters.' }, { status: 400 })
    }

    const db = await getDb()
    const userId = await getRequiredUserId()
    const result = await handleDoubt({
      db,
      userId,
      courseId,
      topicId,
      pageNumber: Number(pageNumber),
      question,
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown doubt chat error'
    const status = message.includes('sign in') ? 401 : message.includes('not found') ? 404 : 500

    return NextResponse.json({ error: message }, { status })
  }
}
