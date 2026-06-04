export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { QuizSession } from '@/components/quiz/QuizSession'
import { BackButton } from '@/components/navigation/BackButton'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'

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
          <Link className="brand" href="/">TruLurn</Link>
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

export default async function QuizPage({ params }: { params: { topicId: string } }) {
  const topicId = decodeURIComponent(params.topicId)
  const db = await getDb()
  const userId = await getRequiredUserId()

  const topic = await db.collection('topics').findOne({ _id: topicId as any })
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
  const course = await db.collection('courses').findOne({ _id: courseId as any, user_id: userId })
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

  return (
    <QuizShell courseId={courseId} topicId={topicId}>
      <div style={{ marginTop: 34 }}>
        <h1 className="page-heading">{topic.title}</h1>
        <p className="page-subtitle">
          One question at a time. The engine uses your Traccia path, lesson pages, and prior evidence to choose what to ask.
        </p>
      </div>
      <QuizSession
        topicId={topicId}
        topicTitle={String(topic.title ?? 'Current topic')}
        courseId={courseId}
      />
    </QuizShell>
  )
}
