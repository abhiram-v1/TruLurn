export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { QuizSession } from '@/components/quiz/QuizSession'
import { getDb } from '@/lib/db'
import { generateWithGemini } from '@/lib/ai/gemini/client'
import { parseGeminiJson } from '@/lib/ai/gemini/json'
import crypto from 'crypto'

async function generateQuizForTopic(course: any, topic: any) {
  const system = `You are TruLurn's quiz generator.
Generate exactly 3 quiz questions for the topic.
We use open-answer questions only, to evaluate cognitive understanding. No multiple choice.
Generate 3 questions matching these types exactly:
1. type "apply": require student to apply the concept to a new scenario.
2. type "spot_error": give a quote or scenario with a conceptual bug, and ask student to find/explain it.
3. type "explain": ask student to explain the mechanism in plain terms to a beginner.

For each question, also write a "rubric" detailing what a strong answer must include (key terms, causal links, mechanisms).
Return ONLY a valid JSON array of 3 question objects, like this:
[
  {
    "type": "apply" | "spot_error" | "explain",
    "question": "question text...",
    "rubric": "rubric details..."
  }
]`

  const user = `Course Topic: ${course.topic}
Topic Title: ${topic.title}
Goals: ${course.goals || 'Understand mechanisms.'}`

  const prompt = { system, user }
  const text = await generateWithGemini(prompt)
  const quizPool = parseGeminiJson<any[]>(text)
  return quizPool
}

export default async function QuizPage({ params }: { params: { topicId: string } }) {
  const db = await getDb()

  // 1. Fetch Topic
  const topic = await db.collection('topics').findOne({ _id: params.topicId as any })
  if (!topic) {
    return <div style={{ padding: 40 }}>Topic not found.</div>
  }

  const courseId = String(topic.course_id)

  // 2. Fetch Course
  const course = await db.collection('courses').findOne({ _id: topic.course_id as any })
  if (!course) {
    return <div style={{ padding: 40 }}>Course not found.</div>
  }

  // 3. Fetch Quiz Questions for this topic
  let questions = await db.collection('quizQuestions').find({ topic_id: params.topicId }).toArray()

  // 4. If no questions exist, generate them
  if (!questions.length) {
    try {
      const generated = await generateQuizForTopic(course, topic)
      const questionsToInsert = generated.map((q: any) => ({
        _id: crypto.randomUUID() as any,
        topic_id: params.topicId,
        type: q.type,
        question: q.question,
        rubric: q.rubric,
        created_at: new Date(),
      }))
      await db.collection('quizQuestions').insertMany(questionsToInsert)
      questions = await db.collection('quizQuestions').find({ topic_id: params.topicId }).toArray()
    } catch (err) {
      console.error('Failed to generate quiz pool on the fly:', err)
      return (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <h2>Failed to load quiz</h2>
          <p>Please check your connection and refresh the page.</p>
        </div>
      )
    }
  }

  const serializedQuestions = questions.map((q) => ({
    id: String(q._id),
    topic_id: String(q.topic_id),
    type: q.type as any,
    question: q.question,
    rubric: q.rubric,
    created_at: q.created_at.toISOString(),
  }))

  return (
    <main className="quiz-page">
      <header className="topbar">
        <Link className="brand" href="/">
          TruLurn
        </Link>
        <Link className="button-subtle" href={`/learn/${courseId}/${params.topicId}`}>
          Back to lesson
        </Link>
      </header>
      <div style={{ marginTop: 34 }}>
        <h1 className="page-heading">{topic.title} quiz</h1>
        <p className="page-subtitle">Open answers only. No multiple choice, no score theater.</p>
      </div>
      <QuizSession topicId={params.topicId} topicTitle={topic.title} questions={serializedQuestions} courseId={courseId} />
    </main>
  )
}
