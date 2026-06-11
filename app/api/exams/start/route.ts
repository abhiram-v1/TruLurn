import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { startOrResumeExam } from '@/lib/quiz/examEngine'
import type { ExamMode } from '@/types'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const courseId = String(body.courseId ?? '')
    const topicId = decodeURIComponent(String(body.topicId ?? ''))
    const mode = String(body.mode ?? 'full_topic') as ExamMode
    const isReview = Boolean(body.isReview)

    if (!courseId || !topicId) {
      return NextResponse.json({ error: 'Missing courseId or topicId.' }, { status: 400 })
    }
    if (!['full_topic', 'spot_check'].includes(mode)) {
      return NextResponse.json({ error: 'Invalid exam mode.' }, { status: 400 })
    }

    const db = await getDb()
    const userId = await getRequiredUserId()
    const state = await startOrResumeExam({ db, courseId, topicId, userId, mode, isReview })
    return NextResponse.json(state)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not start exam.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
