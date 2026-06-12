import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import {
  correctLearnerMemory,
  deleteLearnerMemory,
  getLearnerMemorySnapshot,
  syncLearnerMemoryV2,
} from '@/lib/memory/service'

export async function GET(request: Request) {
  try {
    const userId = await getRequiredUserId()
    const db = await getDb()
    const url = new URL(request.url)
    const courseId = url.searchParams.get('courseId')?.trim() || undefined

    const courses = await db.collection('courses')
      .find({ user_id: userId, ...(courseId ? { _id: courseId as any } : {}) })
      .project({ title: 1, topic: 1 })
      .toArray()
    await Promise.all(courses.map((course) =>
      syncLearnerMemoryV2({
        db,
        userId,
        courseId: String(course._id),
      }).catch((error) => {
        console.warn('[memory] Course sync failed.', error)
      })))
    const snapshot = await getLearnerMemorySnapshot(db, userId, courseId)
    const courseTitles = Object.fromEntries(courses.map((course) => [
      String(course._id),
      String(course.title ?? course.topic ?? 'Course'),
    ]))

    return NextResponse.json({ ...snapshot, courseTitles })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load learner memory.'
    const status = message.includes('sign in') ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export async function PATCH(request: Request) {
  try {
    const userId = await getRequiredUserId()
    const body = await request.json()
    const memoryId = String(body.memoryId ?? '').trim()
    const value = typeof body.value === 'string' ? body.value.trim() : body.value
    if (!memoryId || value == null || value === '') {
      return NextResponse.json({ error: 'memoryId and a non-empty value are required.' }, { status: 400 })
    }
    const db = await getDb()
    const result = await correctLearnerMemory({ db, userId, memoryId, value })
    if (!result) return NextResponse.json({ error: 'Memory not found.' }, { status: 404 })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not correct learner memory.'
    const status = message.includes('sign in') ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await getRequiredUserId()
    const db = await getDb()
    const url = new URL(request.url)
    const memoryId = url.searchParams.get('memoryId')?.trim()
    if (!memoryId) {
      return NextResponse.json({ error: 'memoryId is required.' }, { status: 400 })
    }
    const deleted = await deleteLearnerMemory(db, userId, memoryId)
    if (!deleted) return NextResponse.json({ error: 'Memory not found.' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not delete learner memory.'
    const status = message.includes('sign in') ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
