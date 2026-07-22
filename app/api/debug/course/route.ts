import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

// Temporary diagnostic endpoint — remove before production
export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { searchParams } = new URL(request.url)
  const courseId = searchParams.get('courseId')

  if (!courseId) {
    return NextResponse.json({ error: 'Pass ?courseId=...' }, { status: 400 })
  }

  const db = await getDb()
  const course   = await db.collection('courses').findOne({ _id: courseId as any })
  const branches = await db.collection('branches').find({ course_id: courseId }).toArray()
  const topics   = await db.collection('topics').find({ course_id: courseId }).toArray()
  const pages    = await db.collection('pages').find({ course_id: courseId }).toArray()

  return NextResponse.json({
    course: course ? { _id: String(course._id), user_id: course.user_id, status: course.status } : null,
    branch_count: branches.length,
    branches: branches.map(b => ({
      _id: String(b._id),
      title: b.title,
      active_topic_id: b.active_topic_id,
      topic_count: b.topic_count,
    })),
    topic_count: topics.length,
    topics: topics.slice(0, 5).map(t => ({
      _id: String(t._id),
      title: t.title,
      state: t.state,
      course_id: t.course_id,
    })),
    page_count: pages.length,
  })
}
