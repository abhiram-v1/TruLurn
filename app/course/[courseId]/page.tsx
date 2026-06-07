export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { BigRoadmap } from '@/components/navigation/BigRoadmap'
import { AppFrame } from '@/components/navigation/AppFrame'
import { CourseCodeToggle } from '@/components/course/CourseCodeToggle'
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

  // Fetch ALL topics (including locked) so we can resolve active_topic_id for each branch.
  // On a freshly created course every non-first-branch topic starts locked, so filtering
  // by state would find nothing. We want the first topic in each branch regardless of state.
  const teachableTopics = await db.collection('topics')
    .find({ course_id: params.courseId })
    .sort({ sequence_index: 1, position: 1 })
    .project({ _id: 1, branch_id: 1, node_type: 1, children_count: 1 })
    .toArray()

  function isContainer(t: any) {
    return String(t.node_type ?? '') === 'container' || Number(t.children_count ?? 0) > 0
  }

  // Normalise a slug so dash/underscore and case differences from LLM output don't break matching.
  function normaliseSlug(raw: string) {
    return String(raw ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  }

  function firstTeachableInBranch(branchKey: string): string | null {
    const normKey = normaliseSlug(branchKey)
    for (const t of teachableTopics) {
      if (isContainer(t)) continue
      const normBid = normaliseSlug(String(t.branch_id ?? ''))
      // Match: exact normalised equality, or one is a suffix of the other (handles courseId-prefixed slugs)
      if (
        normBid === normKey ||
        normBid.endsWith(`-${normKey}`) ||
        normKey.endsWith(`-${normBid}`)
      ) {
        return String(t._id)
      }
    }
    return null
  }

  const serializedBranches = branches.map((b) => {
    const branchKey = String(b.branch_key ?? b._id)
    const storedTopicId = b.active_topic_id ? String(b.active_topic_id) : null
    // If the stored topic is a container node, clicking it in the learn page would redirect
    // to its first child which might be locked — so prefer the first real leaf instead.
    const storedIsContainer = storedTopicId
      ? teachableTopics.some((t) => String(t._id) === storedTopicId && isContainer(t))
      : false
    const resolvedTopicId = (!storedIsContainer && storedTopicId)
      ? storedTopicId
      : firstTeachableInBranch(branchKey) ?? storedTopicId
    return {
      id: branchKey,
      course_id: String(b.course_id),
      title: b.title,
      description: b.description,
      state: b.state as any,
      active_topic_id: resolvedTopicId,
      topic_count: b.topic_count,
      mastered_count: b.mastered_count,
    }
  })

  return (
    <AppFrame
      courseId={params.courseId}
      title="Atlas"
      backFallback="/"
      action={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <CourseCodeToggle
            courseId={params.courseId}
            initialLanguage={course.code_language ?? null}
          />
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
