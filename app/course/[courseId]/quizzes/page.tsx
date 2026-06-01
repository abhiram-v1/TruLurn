export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { AppFrame } from '@/components/navigation/AppFrame'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'

type QuizStatus = 'locked' | 'ready' | 'unfinished' | 'review' | 'done'

type QuizLibraryRow = {
  topicId: string
  title: string
  section: string
  status: QuizStatus
  questionCount: number
  generatedAt: Date | null
  attemptedAt: Date | null
  attempts: number
  level: number | null
  passedCount: number | null
  totalAsked: number | null
}

function formatQuizTime(date: Date | null) {
  if (!date) return null

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function statusLabel(status: QuizStatus) {
  if (status === 'done') return 'Completed'
  if (status === 'review') return 'Needs review'
  if (status === 'unfinished') return 'Unfinished'
  if (status === 'locked') return 'Locked'
  return 'Ready'
}

function statusDescription(row: QuizLibraryRow) {
  const generatedAt = formatQuizTime(row.generatedAt)
  const attemptedAt = formatQuizTime(row.attemptedAt)

  if (row.status === 'done') {
    const score = row.passedCount !== null && row.totalAsked
      ? `${row.passedCount}/${row.totalAsked} passed`
      : 'passed'
    return `Completed ${attemptedAt ?? 'recently'} with ${score}${row.level ? ` at level ${row.level}` : ''}. This quiz has already updated the graph.`
  }

  if (row.status === 'review') {
    const score = row.passedCount !== null && row.totalAsked
      ? `${row.passedCount}/${row.totalAsked} passed`
      : 'not passed'
    return `Last attempt ${attemptedAt ?? 'recently'} was ${score}. Retake it to revisit the concepts and update the graph.`
  }

  if (row.status === 'unfinished') {
    return `Generated ${generatedAt ?? 'already'} with ${row.questionCount} questions, but no submitted attempt is stored yet.`
  }

  if (row.status === 'locked') {
    return 'This topic is still locked. Finish its prerequisites before generating a quiz.'
  }

  return 'No quiz has been generated yet. Opening it will create a fresh diagnostic quiz from the stored lesson pages.'
}

function scoreLabel(row: QuizLibraryRow) {
  if (row.status === 'locked') return 'Prerequisites'
  if (row.passedCount !== null && row.totalAsked) return `${row.passedCount}/${row.totalAsked}`
  if (row.questionCount) return `${row.questionCount} questions`
  return 'Not generated'
}

function actionLabel(status: QuizStatus) {
  if (status === 'done') return 'Review quiz'
  if (status === 'review') return 'Retake'
  if (status === 'unfinished') return 'Continue'
  if (status === 'locked') return 'Locked'
  return 'Generate'
}

export default async function CourseQuizzesPage({ params }: { params: { courseId: string } }) {
  const db = await getDb()
  const userId = await getRequiredUserId()
  const course = await db.collection('courses').findOne({ _id: params.courseId as any, user_id: userId })

  if (!course) {
    return (
      <AppFrame courseId={params.courseId} title="Quiz library">
        <main className="quiz-library-page">
          <section className="quiz-library-empty">
            <p className="eyebrow">Not found</p>
            <h1 className="page-heading">Course not found</h1>
            <p className="page-subtitle">Please check the URL or return home.</p>
            <Link className="button" href="/">Home</Link>
          </section>
        </main>
      </AppFrame>
    )
  }

  const [topics, questions, attempts] = await Promise.all([
    db.collection('topics')
      .find({ course_id: params.courseId })
      .project({ title: 1, section: 1, state: 1, position: 1, branch_id: 1, branch_position: 1, created_at: 1 })
      .sort({ branch_position: 1, branch_id: 1, position: 1, created_at: 1 })
      .toArray(),
    db.collection('quizQuestions')
      .find({ course_id: params.courseId, user_id: userId })
      .sort({ created_at: -1 })
      .toArray(),
    db.collection('quizAttempts')
      .find({ course_id: params.courseId, user_id: userId })
      .sort({ created_at: -1 })
      .toArray(),
  ])

  const questionsByTopic = new Map<string, { count: number; generatedAt: Date | null }>()
  for (const question of questions) {
    const topicId = String(question.topic_id)
    const current = questionsByTopic.get(topicId) ?? { count: 0, generatedAt: null }
    const createdAt = question.created_at instanceof Date ? question.created_at : null
    questionsByTopic.set(topicId, {
      count: current.count + 1,
      generatedAt: current.generatedAt && createdAt
        ? current.generatedAt > createdAt ? current.generatedAt : createdAt
        : current.generatedAt ?? createdAt,
    })
  }

  const attemptsByTopic = new Map<string, any[]>()
  for (const attempt of attempts) {
    const topicId = String(attempt.topic_id)
    attemptsByTopic.set(topicId, [...(attemptsByTopic.get(topicId) ?? []), attempt])
  }

  const rows: QuizLibraryRow[] = topics.map((topic) => {
    const topicId = String(topic._id)
    const quiz = questionsByTopic.get(topicId)
    const topicAttempts = attemptsByTopic.get(topicId) ?? []
    const latestAttempt = topicAttempts[0]
    const passed = Boolean(latestAttempt?.passed)
    const attemptedAt = latestAttempt?.created_at instanceof Date ? latestAttempt.created_at : null
    const evaluation = latestAttempt?.evaluation && typeof latestAttempt.evaluation === 'object'
      ? Object.values(latestAttempt.evaluation as Record<string, any>)
      : []
    const passedCount = evaluation.length
      ? evaluation.filter((item: any) => Boolean(item?.passed)).length
      : null
    const totalAsked = Array.isArray(latestAttempt?.questions_asked)
      ? latestAttempt.questions_asked.length
      : evaluation.length || null
    const topicState = String(topic.state ?? 'active')

    return {
      topicId,
      title: String(topic.title ?? 'Untitled topic'),
      section: String(topic.section ?? course.title ?? 'Course topic'),
      status: topicState === 'locked' ? 'locked' : passed ? 'done' : latestAttempt ? 'review' : quiz ? 'unfinished' : 'ready',
      questionCount: quiz?.count ?? 0,
      generatedAt: quiz?.generatedAt ?? null,
      attemptedAt,
      attempts: topicAttempts.length,
      level: typeof latestAttempt?.overall_level === 'number' ? latestAttempt.overall_level : null,
      passedCount,
      totalAsked,
    }
  })

  const availableCount = rows.filter((row) => row.status !== 'locked').length
  const doneCount = rows.filter((row) => row.status === 'done').length
  const reviewCount = rows.filter((row) => row.status === 'review').length

  return (
    <AppFrame
      courseId={params.courseId}
      title="Quiz library"
      backFallback={`/course/${params.courseId}`}
      action={<Link className="button-subtle" href={`/course/${params.courseId}`}>Atlas</Link>}
    >
      <main className="quiz-library-page">
        <header className="quiz-library-hero">
          <p className="eyebrow">{course.title}</p>
          <h1 className="page-heading">Quiz library</h1>
          <p className="page-subtitle">
            One course-wide list of topic quizzes. Passing a quiz updates the graph; skipping a quiz never changes mastery.
          </p>
        </header>

        <section className="quiz-library-summary" aria-label="Quiz summary">
          <div>
            <strong>{availableCount}</strong>
            <span>available</span>
          </div>
          <div>
            <strong>{doneCount}</strong>
            <span>completed</span>
          </div>
          <div>
            <strong>{reviewCount}</strong>
            <span>needs review</span>
          </div>
        </section>

        <section className="quiz-long-list" aria-label="Course quizzes">
          {rows.map((row, index) => {
            const content = (
              <>
                <span className="quiz-list-index">{String(index + 1).padStart(2, '0')}</span>
                <span className={`quiz-status ${row.status}`}>{statusLabel(row.status)}</span>
                <span className="quiz-row-main">
                  <strong>{row.title}</strong>
                  <span>{statusDescription(row)}</span>
                  <small>{row.section}</small>
                </span>
                <span className="quiz-row-meta">
                  <strong>{scoreLabel(row)}</strong>
                  <span>{row.attempts ? `${row.attempts} attempt${row.attempts === 1 ? '' : 's'}` : 'No attempts'}</span>
                </span>
                <span className={`quiz-row-action ${row.status}`}>{actionLabel(row.status)}</span>
              </>
            )

            return row.status === 'locked' ? (
              <div className="quiz-long-row locked" key={row.topicId}>
                {content}
              </div>
            ) : (
              <Link className="quiz-long-row" href={`/quiz/${encodeURIComponent(row.topicId)}`} key={row.topicId}>
                {content}
              </Link>
            )
          })}
        </section>
      </main>
    </AppFrame>
  )
}
