import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import type { GraphNodeUpdate } from '@/lib/graph/types'

export async function POST(
  request: Request,
  { params }: { params: { courseId: string } },
) {
  try {
    const userId = await getRequiredUserId()
    const { courseId } = params
    const body = await request.json() as {
      updates: GraphNodeUpdate[]
      unlocked: string[]
    }

    if (!body.updates || !Array.isArray(body.updates)) {
      return NextResponse.json({ error: 'updates array required' }, { status: 400 })
    }

    const db = await getDb()

    // Verify course ownership
    const course = await db.collection('courses').findOne({ _id: courseId as any, user_id: userId })
    if (!course) {
      return NextResponse.json({ error: 'Course not found.' }, { status: 404 })
    }

    // Apply all node updates
    for (const upd of body.updates) {
      const $set: Record<string, unknown> = { updated_at: new Date() }
      if (upd.state !== undefined)        $set.state = upd.state
      if (upd.mastery !== undefined)      $set.understanding_level = Math.round(upd.mastery / 20)
      if (upd.misconception !== undefined) $set.misconception = upd.misconception
      if (upd.suggested !== undefined)    $set.suggested = upd.suggested

      await db.collection('topics').updateOne(
        { _id: upd.topicId as any, course_id: courseId },
        { $set },
      )
    }

    // Clear previous suggested flags then set the new one
    const suggestedUpdate = body.updates.find((u) => u.suggested === true)
    if (suggestedUpdate) {
      // Clear all other suggested flags for this course
      await db.collection('topics').updateMany(
        { course_id: courseId, _id: { $ne: suggestedUpdate.topicId as any } },
        { $set: { suggested: false } },
      )
    }

    // Unlock topics
    for (const topicId of body.unlocked ?? []) {
      await db.collection('topics').updateOne(
        { _id: topicId as any, course_id: courseId, state: 'locked' },
        { $set: { state: 'active', updated_at: new Date() } },
      )
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    const status = message.includes('sign in') ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}