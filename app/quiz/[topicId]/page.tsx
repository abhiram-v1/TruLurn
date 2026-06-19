export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { QuizSession } from '@/components/quiz/QuizSession'
import { BackButton } from '@/components/navigation/BackButton'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { getCachedCourse, getCachedTopicById } from '@/lib/cache/courseData'
import { TruLurnLogo } from '@/components/ui/TruLurnLogo'

function QuizShell({
  children,
  courseId,
  topicId,
}: {
  children: React.ReactNode
  courseId?: string
  topicId?: string
}) {
  const lessonHref = courseId && topicId ? `/learn/${courseId}/${topicId}` : '/'
  return (
    <main className="quiz-page">
      <header className="topbar">
        <div className="topbar-left">
          <BackButton fallbackHref={lessonHref} />
          <Link className="brand" href="/" style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            <TruLurnLogo size={22} />
            <span>TruLurn</span>
          </Link>
        </div>
        {courseId && topicId ? (
          <Link className="button-subtle" href={lessonHref}>
            Back to lesson
          </Link>
        ) : null}
      </header>
      {children}
    </main>
  )
}

export default async function QuizPage({
  params,
  searchParams,
}: {
  params: { topicId: string }
  searchParams: { review?: string; mode?: string }
}) {
  const topicId = decodeURIComponent(params.topicId)
  const isReview = searchParams?.review === '1'
  const isCourseCheckpoint = searchParams?.mode === 'checkpoint'
  const db = await getDb()
  const userId = await getRequiredUserId()

  const topic = await getCachedTopicById(db, topicId)
  if (!topic) {
    return (
      <QuizShell>
        <div style={{ padding: '40px 0', textAlign: 'center' }}>
          <h2 className="page-heading">Topic not found</h2>
          <p className="page-subtitle">The topic ID in this URL is invalid or the topic was deleted.</p>
        </div>
      </QuizShell>
    )
  }

  const courseId = String(topic.course_id)
  const course = await getCachedCourse(db, courseId, userId)
  if (!course) {
    return (
      <QuizShell courseId={courseId} topicId={topicId}>
        <div style={{ padding: '40px 0', textAlign: 'center' }}>
          <h2 className="page-heading">Access denied</h2>
          <p className="page-subtitle">This course does not belong to your account.</p>
        </div>
      </QuizShell>
    )
  }

  const examMode = isReview ? 'spot_check' : isCourseCheckpoint ? 'course_checkpoint' : 'full_topic'

  return (
    <QuizShell courseId={courseId} topicId={topicId}>
      <div style={{ marginTop: 34 }}>
        {isReview ? <p className="eyebrow">Spaced review</p> : null}
        {isCourseCheckpoint ? <p className="eyebrow">Course check-in</p> : null}
        <h1 className="page-heading">
          {isCourseCheckpoint ? `${String(course.title ?? course.topic ?? 'Course')} check-in` : String(topic.title)}
        </h1>
        <p className="page-subtitle">
          {isCourseCheckpoint
            ? 'A short quiz across everything you\'ve covered so far. Gaps are surfaced while the material is still fresh.'
            : isReview
              ? 'A quick retrieval check to keep this topic fresh. Pass it and the next review moves further out; miss it and it comes back sooner.'
              : 'One question at a time. The engine uses your Traccia path, lesson pages, and prior evidence to choose what to ask.'}
        </p>
      </div>
      <QuizSession
        topicId={topicId}
        topicTitle={isCourseCheckpoint ? String(course.title ?? course.topic ?? 'Course') : String(topic.title ?? 'Current topic')}
        courseId={courseId}
        mode={examMode}
        isReview={isReview}
      />
    </QuizShell>
  )
}
