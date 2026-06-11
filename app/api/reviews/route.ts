import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { getDueReviews } from '@/lib/review/schedule'

// GET /api/reviews            — all due reviews for the user
// GET /api/reviews?courseId=… — due reviews scoped to one course
export async function GET(request: Request) {
  try {
    const userId = await getRequiredUserId()
    const db = await getDb()
    const url = new URL(request.url)
    const courseId = url.searchParams.get('courseId') ?? undefined

    const reviews = await getDueReviews({ db, userId, courseId })
    return NextResponse.json({ reviews, count: reviews.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load reviews.'
    const status = message.includes('sign in') ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
