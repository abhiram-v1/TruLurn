import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { generateWithGemini } from '@/lib/ai/gemini/client'
import { parseGeminiJson } from '@/lib/ai/gemini/json'
import { unlockNextTopics } from '@/lib/db-helpers'
import crypto from 'crypto'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { topicId, answers } = body

    if (!topicId || !answers) {
      return NextResponse.json({ error: 'Missing required evaluation parameters.' }, { status: 400 })
    }

    const db = await getDb()

    // 1. Fetch Topic
    const topic = await db.collection('topics').findOne({ _id: topicId as any })
    if (!topic) {
      return NextResponse.json({ error: 'Topic not found.' }, { status: 404 })
    }

    // 2. Fetch Quiz Questions for this Topic
    const questions = await db.collection('quizQuestions').find({ topic_id: topicId }).toArray()
    if (!questions.length) {
      return NextResponse.json({ error: 'No quiz questions found for this topic.' }, { status: 404 })
    }

    // 3. Evaluate each answer in parallel via Gemini
    const evalPromises = questions.map(async (q) => {
      const studentAnswer = answers[String(q._id)] || ''
      
      const prompt = {
        system: `You are TruLurn's strict answer evaluation teacher. You grade the student's answer against the given question and rubric.
Be extremely strict. We grade on cognitive mastery, not completion.
Catches:
- Memorized answers with no explained reasoning.
- Vague, high-level answers that don't explain the underlying mechanism.
- False confidence (confident tone, wrong content).

Return ONLY valid JSON matching this structure:
{
  "level": 1, // 1 to 5 (1: Recognition, 2: Mechanical, 3: Conceptual, 4: Transfer, 5: Intuitive)
  "passed": false, // true if level >= 3, false otherwise
  "feedback": "constructive explanation of what they did well or got wrong",
  "gap": "short description of the gap in understanding, or null if passed",
  "false_confidence": false // true if they sounded highly confident but wrote incorrect/vague content
}`,
        user: `Topic: ${topic.title}
Question Type: ${q.type}
Question: ${q.question}
Grading Rubric: ${q.rubric || 'No rubric supplied.'}
Student Answer: ${studentAnswer}`,
      }

      try {
        const geminiText = await generateWithGemini(prompt)
        const evaluation = parseGeminiJson<any>(geminiText)

        return {
          questionId: String(q._id),
          evaluation: {
            level: Number(evaluation.level || 2),
            passed: Boolean(evaluation.passed ?? false),
            feedback: String(evaluation.feedback || 'Could not evaluate answer.'),
            gap: evaluation.gap || null,
            false_confidence: Boolean(evaluation.false_confidence ?? false),
          },
        }
      } catch (err) {
        console.error(`Gemini evaluation failed for question ${q._id}:`, err)
        return {
          questionId: String(q._id),
          evaluation: {
            level: 2,
            passed: false,
            feedback: 'Evaluation service temporarily unavailable. Please try again.',
            gap: 'System error during grading.',
            false_confidence: false,
          },
        }
      }
    })

    const evalResults = await Promise.all(evalPromises)

    // 4. Calculate overall progress
    const passed = evalResults.every((r) => r.evaluation.passed)
    const levels = evalResults.map((r) => r.evaluation.level)
    const overallLevel = Math.min(...levels) // standard: weakest link model

    const evaluationMap = Object.fromEntries(evalResults.map((r) => [r.questionId, r.evaluation]))

    // 5. Save Quiz Attempt
    const attemptId = crypto.randomUUID()
    await db.collection('quizAttempts').insertOne({
      _id: attemptId as any,
      topic_id: topicId,
      user_id: 'local-user',
      questions_asked: questions.map((q) => q._id),
      answers: answers,
      evaluation: evaluationMap,
      overall_level: overallLevel,
      passed: passed,
      created_at: new Date(),
    })

    // 6. If passed, unlock next roadmap nodes
    if (passed) {
      await unlockNextTopics(String(topic.course_id), topicId)
    }

    return NextResponse.json({
      evaluations: evaluationMap,
      passed,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown quiz evaluation error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
