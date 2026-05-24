import Link from 'next/link'
import { QuizSession } from '@/components/quiz/QuizSession'
import { getTopic, mockQuestions } from '@/lib/mock-data'

export default function QuizPage({ params }: { params: { topicId: string } }) {
  const topic = getTopic(params.topicId)
  const questions = mockQuestions.filter((question) => question.topic_id === topic.id)

  return (
    <main className="quiz-page">
      <header className="topbar">
        <Link className="brand" href="/">
          TruLurn
        </Link>
        <Link className="button-subtle" href={`/learn/course-ml/${topic.id}`}>
          Back to lesson
        </Link>
      </header>
      <div style={{ marginTop: 34 }}>
        <h1 className="page-heading">{topic.title} quiz</h1>
        <p className="page-subtitle">Open answers only. No multiple choice, no score theater.</p>
      </div>
      <QuizSession topicId={topic.id} topicTitle={topic.title} questions={questions} />
    </main>
  )
}
