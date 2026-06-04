import { redirect } from 'next/navigation'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { firstTeachableTopic } from '@/lib/traccia/sequence'

export default async function CourseRedirectPage({ params }: { params: { courseId: string } }) {
  const db = await getDb()
  const userId = await getRequiredUserId()
  const course = await db.collection('courses').findOne({ _id: params.courseId as any, user_id: userId })

  if (!course) {
    redirect('/')
  }

  const topics = await db.collection('topics')
    .find({ course_id: params.courseId, state: { $ne: 'locked' } })
    .sort({ sequence_index: 1, position: 1 })
    .toArray()
  const first = firstTeachableTopic(topics as any)

  redirect(first ? `/learn/${params.courseId}/${encodeURIComponent(String(first._id))}` : `/course/${params.courseId}`)
}
