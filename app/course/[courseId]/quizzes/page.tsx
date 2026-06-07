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
  displayStatus: 'Available' | 'Continue' | 'Review' | 'Completed'
  questionCount: number
  generatedAt: Date | null
  attemptedAt: Date | null
  attempts: number
  level: number | null
  passedCount: number | null
  totalAsked: number | null
  activeSessionId: string | null
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
    return `Completed ${attemptedAt ?? 'recently'} with ${score}. This quiz has already updated the graph.`
  }

  if (row.status === 'review') {
    const score = row.passedCount !== null && row.totalAsked
      ? `${row.passedCount}/${row.totalAsked} passed`
      : 'not passed'
    return `Last attempt ${attemptedAt ?? 'recently'} was ${score}. Retake it to revisit the concepts and update the graph.`
  }

  if (row.status === 'unfinished') {
    return row.activeSessionId
      ? `Started ${generatedAt ?? 'recently'}. Continue the adaptive exam from the next unanswered question.`
      : `Generated ${generatedAt ?? 'already'} with ${row.questionCount} questions, but no submitted attempt is stored yet.`
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

  const [topics, questions, attempts, examSessions] = await Promise.all([
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
    db.collection('examSessions')
      .find({ course_id: params.courseId, user_id: userId })
      .sort({ updated_at: -1, created_at: -1 })
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

  const sessionsByTopic = new Map<string, any[]>()
  for (const session of examSessions) {
    const topicId = String(session.topic_id)
    sessionsByTopic.set(topicId, [...(sessionsByTopic.get(topicId) ?? []), session])
  }

  const rows = topics.map((topic) => {
    const topicId = String(topic._id)
    const quiz = questionsByTopic.get(topicId)
    const topicAttempts = attemptsByTopic.get(topicId) ?? []
    const topicSessions = sessionsByTopic.get(topicId) ?? []
    const latestSession = topicSessions[0]
    const latestAttempt = topicAttempts[0]
    const sessionSummary = latestSession?.summary && typeof latestSession.summary === 'object'
      ? latestSession.summary
      : null
    const passed = latestSession?.status === 'completed'
      ? Boolean(sessionSummary?.passed)
      : Boolean(latestAttempt?.passed)
    const attemptedAt = latestSession?.completed_at instanceof Date
      ? latestSession.completed_at
      : latestAttempt?.created_at instanceof Date ? latestAttempt.created_at : null
    const generatedAt = latestSession?.started_at instanceof Date
      ? latestSession.started_at
      : quiz?.generatedAt ?? null
    const evaluation = latestAttempt?.evaluation && typeof latestAttempt.evaluation === 'object'
      ? Object.values(latestAttempt.evaluation as Record<string, any>)
      : []
    const passedCount = typeof sessionSummary?.passed_count === 'number'
      ? sessionSummary.passed_count
      : evaluation.length
      ? evaluation.filter((item: any) => Boolean(item?.passed)).length
      : null
    const totalAsked = typeof sessionSummary?.total_questions === 'number'
      ? sessionSummary.total_questions
      : Array.isArray(latestAttempt?.questions_asked)
      ? latestAttempt.questions_asked.length
      : evaluation.length || null
    const topicState = String(topic.state ?? 'active')
    const isActiveSession = latestSession?.status === 'active'

    const status: QuizStatus = topicState === 'locked' ? 'locked' : isActiveSession ? 'unfinished' : passed ? 'done' : latestSession?.status === 'completed' || latestAttempt ? 'review' : quiz ? 'unfinished' : 'ready'

    let displayStatus: 'Available' | 'Continue' | 'Review' | 'Completed' | 'Hidden' = 'Hidden'
    if (status === 'done') {
      displayStatus = 'Completed'
    } else if (status === 'review') {
      displayStatus = 'Review'
    } else if (status === 'unfinished') {
      displayStatus = 'Continue'
    } else if (status === 'ready') {
      displayStatus = 'Available'
    }

    return {
      topicId,
      title: String(topic.title ?? 'Untitled topic'),
      section: String(topic.section ?? course.title ?? 'Course topic'),
      status,
      displayStatus,
      questionCount: typeof sessionSummary?.total_questions === 'number' ? sessionSummary.total_questions : quiz?.count ?? 0,
      generatedAt,
      attemptedAt,
      attempts: Math.max(topicAttempts.length, topicSessions.filter((session) => session.status === 'completed').length),
      level: typeof sessionSummary?.overall_level === 'number'
        ? sessionSummary.overall_level
        : typeof latestAttempt?.overall_level === 'number' ? latestAttempt.overall_level : null,
      passedCount,
      totalAsked,
      activeSessionId: isActiveSession ? String(latestSession._id) : null,
    }
  })

  // Filter only 'Available', 'Continue', 'Review', or 'Completed' quizzes.
  const filteredRows: QuizLibraryRow[] = rows.filter(
    (row): row is QuizLibraryRow & { displayStatus: 'Available' | 'Continue' | 'Review' | 'Completed' } =>
      row.displayStatus !== 'Hidden'
  )

  const availableCount = filteredRows.filter((row) => row.displayStatus === 'Available' || row.displayStatus === 'Continue').length
  const completedCount = filteredRows.filter((row) => row.displayStatus === 'Completed').length
  const reviewCount = filteredRows.filter((row) => row.displayStatus === 'Review').length

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
            <strong>{completedCount}</strong>
            <span>completed</span>
          </div>
          <div>
            <strong>{reviewCount}</strong>
            <span>review</span>
          </div>
        </section>

        <section className="quiz-long-list" aria-label="Course quizzes">
          {filteredRows.map((row, index) => {
            const statusClass = row.displayStatus.toLowerCase()
            const content = (
              <>
                <span className="quiz-list-index">{String(index + 1).padStart(2, '0')}</span>
                <span className={`quiz-status ${statusClass}`}>{row.displayStatus}</span>
                <span className="quiz-row-main">
                  <strong>{row.title}</strong>
                  <span>{statusDescription(row)}</span>
                  <small>{row.section}</small>
                </span>
                <span className="quiz-row-meta">
                  <strong>{scoreLabel(row)}</strong>
                  <span>{row.attempts ? `${row.attempts} attempt${row.attempts === 1 ? '' : 's'}` : 'No attempts'}</span>
                </span>
                <span className={`quiz-row-action ${statusClass}`}>{actionLabel(row.status)}</span>
              </>
            )

            return (
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
