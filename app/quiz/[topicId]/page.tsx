export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { QuizSession } from '@/components/quiz/QuizSession'
import { BackButton } from '@/components/navigation/BackButton'
import { getDb } from '@/lib/db'
import { generateQuizQuestions, QUIZ_SESSION_SIZE } from '@/lib/quiz/generateQuizQuestions'
import crypto from 'crypto'
import { getRequiredUserId } from '@/lib/server/currentUser'

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function QuizPage({ params }: { params: { topicId: string } }) {
  // Decode the topicId — Next.js encodes colons in path segments as %3A
  const topicId = decodeURIComponent(params.topicId)

  const db = await getDb()
  const userId = await getRequiredUserId()

  // 1. Fetch Topic (with decoded ID)
  const topic = await db.collection('topics').findOne({ _id: topicId as any })
  if (!topic) {
    return (
      <main className="quiz-page">
        <header className="topbar">
          <div className="topbar-left">
            <BackButton fallbackHref="/" />
            <Link className="brand" href="/">TruLurn</Link>
          </div>
        </header>
        <div style={{ padding: '40px 0', textAlign: 'center' }}>
          <h2 className="page-heading">Topic not found</h2>
          <p className="page-subtitle">The topic ID in this URL is invalid or the topic was deleted.</p>
        </div>
      </main>
    )
  }

  const courseId = String(topic.course_id)

  // 2. Verify course ownership
  const course = await db.collection('courses').findOne({ _id: courseId as any, user_id: userId })
  if (!course) {
    return (
      <main className="quiz-page">
        <header className="topbar">
          <div className="topbar-left">
            <BackButton fallbackHref="/" />
            <Link className="brand" href="/">TruLurn</Link>
          </div>
        </header>
        <div style={{ padding: '40px 0', textAlign: 'center' }}>
          <h2 className="page-heading">Access denied</h2>
          <p className="page-subtitle">This course does not belong to your account.</p>
        </div>
      </main>
    )
  }

  // 3. Load or generate quiz questions.
  // When the pool has more than QUIZ_SESSION_SIZE questions (e.g. pre-generated at unlock),
  // sample randomly so each retake feels different and prevents answer memorisation.
  const poolCount = await db.collection('quizQuestions')
    .countDocuments({ course_id: courseId, topic_id: topicId })

  let questions: any[] = []

  if (poolCount === 0) {
    // Generate on first visit — stores the initial pool
    try {
      const generated = await generateQuizQuestions(db, course, topic, userId)
      const docs = generated.map((q: any) => ({
        _id: crypto.randomUUID() as any,
        course_id: courseId,
        topic_id: topicId,
        user_id: userId,
        type: q.type,
        question: q.question,
        options: q.options ?? null,
        correct_answer: q.correct_answer ?? null,
        rubric: q.rubric ?? null,
        created_at: new Date(),
      }))
      await db.collection('quizQuestions').insertMany(docs)
      questions = await db.collection('quizQuestions')
        .find({ course_id: courseId, topic_id: topicId })
        .toArray()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      return (
        <main className="quiz-page">
          <header className="topbar">
            <div className="topbar-left">
              <BackButton fallbackHref={`/learn/${courseId}/${topicId}`} />
              <Link className="brand" href="/">TruLurn</Link>
            </div>
            <Link className="button-subtle" href={`/learn/${courseId}/${topicId}`}>Back to lesson</Link>
          </header>
          <div style={{ padding: '40px 0', textAlign: 'center' }}>
            <h2 className="page-heading">Quiz generation failed</h2>
            <p className="page-subtitle">{msg}</p>
            <p className="course-meta" style={{ marginTop: 8 }}>Refresh to try again.</p>
          </div>
        </main>
      )
    }
  } else if (poolCount > QUIZ_SESSION_SIZE) {
    // Pool is large enough to sample from — gives variety on retake
    questions = await db.collection('quizQuestions')
      .aggregate([
        { $match: { course_id: courseId, topic_id: topicId } },
        { $sample: { size: QUIZ_SESSION_SIZE } },
      ])
      .toArray()
  } else {
    questions = await db.collection('quizQuestions')
      .find({ course_id: courseId, topic_id: topicId })
      .toArray()
  }

  const serializedQuestions = questions.map((q) => ({
    id: String(q._id),
    topic_id: String(q.topic_id),
    type: q.type as any,
    question: q.question,
    options: Array.isArray(q.options) ? q.options : null,
    rubric: q.rubric ?? null,
    created_at: q.created_at.toISOString(),
    // correct_answer is intentionally excluded — evaluated server-side only
  }))

  return (
    <main className="quiz-page">
      <header className="topbar">
        <div className="topbar-left">
          <BackButton fallbackHref={`/learn/${courseId}/${topicId}`} />
          <Link className="brand" href="/">TruLurn</Link>
        </div>
        <Link className="button-subtle" href={`/learn/${courseId}/${topicId}`}>
          Back to lesson
        </Link>
      </header>
      <div style={{ marginTop: 34 }}>
        <h1 className="page-heading">{topic.title}</h1>
        <p className="page-subtitle">
          Open-answer questions. Programming topics may ask you to write or fix code directly.
        </p>
      </div>
      <QuizSession
        topicId={topicId}
        topicTitle={topic.title}
        questions={serializedQuestions}
        courseId={courseId}
      />
    </main>
  )
}
