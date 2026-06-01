export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { BigRoadmap } from '@/components/navigation/BigRoadmap'
import { AppFrame } from '@/components/navigation/AppFrame'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'

export default async function CourseRoadmapPage({ params }: { params: { courseId: string } }) {
  const db = await getDb()
  const userId = await getRequiredUserId()
  const course = await db.collection('courses').findOne({ _id: params.courseId as any, user_id: userId })

  if (!course) {
    return (
      <AppFrame courseId={params.courseId} title="Not Found">
        <main className="roadmap-page" style={{ padding: 40, textAlign: 'center' }}>
          <h1 className="page-heading">Course not found</h1>
          <p className="page-subtitle">Please check the URL or create a new course.</p>
          <Link className="button" href="/setup" style={{ marginTop: 20, display: 'inline-block' }}>
            Build a curriculum
          </Link>
        </main>
      </AppFrame>
    )
  }

  const branches = await db.collection('branches').find({ course_id: params.courseId }).toArray()
  const serializedBranches = branches.map((b) => ({
    id: String(b.branch_key ?? b._id),
    course_id: String(b.course_id),
    title: b.title,
    description: b.description,
    state: b.state as any,
    active_topic_id: b.active_topic_id,
    topic_count: b.topic_count,
    mastered_count: b.mastered_count,
  }))

  return (
    <AppFrame
      courseId={params.courseId}
      title="Atlas"
      backFallback="/"
      action={
        <div style={{ display: 'flex', gap: 8 }}>
          <Link className="button-subtle" href={`/graph/${params.courseId}`}>Knowledge graph</Link>
          <Link className="button-subtle" href="/setup">New course</Link>
        </div>
      }
    >
      <main className="roadmap-page">
        <div className="page-header" style={{ textAlign: 'center', maxWidth: 600, margin: '0 auto 10px' }}>
          <p className="eyebrow">{course.title}</p>
          <h1 className="page-heading">Atlas</h1>
          <p className="page-subtitle">
            Follow the course structure through each milestone. Master one branch to unlock deeper connections.
          </p>
        </div>
        <BigRoadmap branches={serializedBranches} courseId={params.courseId} />
      </main>
    </AppFrame>
  )
}
