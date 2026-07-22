import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { startOrResumeExam } from '@/lib/quiz/examEngine'
import type { ExamMode } from '@/types'
import { apiUsageErrorResponse, consumeApiUsage } from '@/lib/server/apiUsage'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const courseId = String(body.courseId ?? '')
    const topicId = decodeURIComponent(String(body.topicId ?? ''))
    const mode = String(body.mode ?? 'full_topic') as ExamMode
    const isReview = Boolean(body.isReview)
    const forceNew = Boolean(body.forceNew)

    if (!courseId || !topicId) {
      return NextResponse.json({ error: 'Missing courseId or topicId.' }, { status: 400 })
    }
    if (!['full_topic', 'spot_check', 'course_checkpoint'].includes(mode)) {
      return NextResponse.json({ error: 'Invalid exam mode.' }, { status: 400 })
    }

    const db = await getDb()
    const userId = await getRequiredUserId()
    await consumeApiUsage({ userId, bucket: 'quiz_actions', scope: 'quiz', db })
    const state = await startOrResumeExam({ db, courseId, topicId, userId, mode, isReview, forceNew })
    return NextResponse.json(state)
  } catch (error) {
    const limited = apiUsageErrorResponse(error)
    if (limited) return limited
    const message = error instanceof Error ? error.message : 'Could not start exam.'
    const status = message.toLowerCase().includes('sign in') ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
