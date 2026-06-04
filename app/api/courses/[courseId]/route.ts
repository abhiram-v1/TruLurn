import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'

const COURSE_SCOPED_COLLECTIONS = [
  'branches',
  'topics',
  'topicEdges',
  'courseSummaries',
  'topicSummaries',
  'pages',
  'pageSummaries',
  'doubtMessages',
  'quizQuestions',
  'quizAttempts',
  'examSessions',
  'examTurns',
  'sourceChunks',
] as const

export async function DELETE(
  _request: Request,
  { params }: { params: { courseId: string } },
) {
  try {
    const courseId = params.courseId?.trim()

    if (!courseId) {
      return NextResponse.json({ error: 'courseId is required.' }, { status: 400 })
    }

    const userId = await getRequiredUserId()
    const db = await getDb()
    const course = await db.collection('courses').findOne({
      _id: courseId as any,
      user_id: userId,
    })

    if (!course) {
      return NextResponse.json({ error: 'Course not found.' }, { status: 404 })
    }

    const deleteResults = await Promise.all(
      COURSE_SCOPED_COLLECTIONS.map(async (collectionName) => {
        const result = await db.collection(collectionName).deleteMany({ course_id: courseId })
        return [collectionName, result.deletedCount] as const
      }),
    )

    const courseResult = await db.collection('courses').deleteOne({
      _id: courseId as any,
      user_id: userId,
    })

    return NextResponse.json({
      deleted: true,
      counts: {
        courses: courseResult.deletedCount,
        ...Object.fromEntries(deleteResults),
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown course deletion error'
    const status = message.includes('sign in') ? 401 : 500

    return NextResponse.json({ error: message }, { status })
  }
}
