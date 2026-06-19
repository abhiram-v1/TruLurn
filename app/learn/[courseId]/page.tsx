import { redirect } from 'next/navigation'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { firstTeachableTopic } from '@/lib/traccia/sequence'
import { getCachedCourse, getCachedCourseTopics } from '@/lib/cache/courseData'

export default async function CourseRedirectPage({ params }: { params: { courseId: string } }) {
  const db = await getDb()
  const userId = await getRequiredUserId()
  const [course, allTopics] = await Promise.all([
    getCachedCourse(db, params.courseId, userId),
    getCachedCourseTopics(db, params.courseId),
  ])

  if (!course) {
    redirect('/')
  }

  const activeTopics = allTopics.filter((t) => t.state !== 'locked')
  const first = firstTeachableTopic(activeTopics as any)

  redirect(first ? `/learn/${params.courseId}/${encodeURIComponent(String(first._id))}` : `/course/${params.courseId}`)
}
