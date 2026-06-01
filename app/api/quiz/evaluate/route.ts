import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { generateWithGemini } from '@/lib/ai/gemini/client'
import { parseGeminiJson } from '@/lib/ai/gemini/json'
import { unlockNextTopics } from '@/lib/db-helpers'
import { evaluateQuizForGraph } from '@/lib/ai/graphEvaluator'
import { generateTopicPage, buildPageDocument } from '@/lib/topic-pages/generateTopicPage'
import crypto from 'crypto'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { embedPageById, retrieveCourseMemory } from '@/lib/vector/retrieval'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    // Safety decode: topicId may arrive URL-encoded (%3A for colon) from older clients
    const { courseId, answers } = body
    const topicId = decodeURIComponent(String(body.topicId ?? ''))

    if (!courseId || !topicId || !answers) {
      return NextResponse.json({ error: 'Missing required evaluation parameters.' }, { status: 400 })
    }

    const db = await getDb()
    const userId = await getRequiredUserId()
    const course = await db.collection('courses').findOne({ _id: courseId as any, user_id: userId })

    if (!course) {
      return NextResponse.json({ error: 'Course not found.' }, { status: 404 })
    }

    // 1. Fetch Topic
    const topic = await db.collection('topics').findOne({ _id: topicId as any, course_id: courseId })
    if (!topic) {
      return NextResponse.json({ error: 'Topic not found.' }, { status: 404 })
    }

    // 2. Fetch only the questions whose IDs were actually submitted.
    // Fetching all questions for the topic would include questions from pre-generated
    // pools that were not shown — evaluating them with empty answers always fails
    // and corrupts the pass/fail calculation.
    const submittedIds = Object.keys(answers).filter((id) => id.trim())
    if (!submittedIds.length) {
      return NextResponse.json({ error: 'No answers submitted.' }, { status: 400 })
    }

    const questions = await db.collection('quizQuestions')
      .find({ course_id: courseId, topic_id: topicId, _id: { $in: submittedIds as any[] } })
      .toArray()
    if (!questions.length) {
      return NextResponse.json({ error: 'No quiz questions found for this topic.' }, { status: 404 })
    }

    // 3. Evaluate each answer in parallel
    const evalPromises = questions.map(async (q) => {
      const studentAnswer = answers[String(q._id)] || ''

      // Auto-grade MCQ and true/false — no AI call needed
      if ((q.type === 'mcq' || q.type === 'true_false') && q.correct_answer != null) {
        const correct = String(q.correct_answer).trim().toLowerCase()
        const submitted = String(studentAnswer).trim().toLowerCase()
        const isCorrect = submitted !== '' && submitted === correct
        return {
          questionId: String(q._id),
          evaluation: {
            level: isCorrect ? 3 : 1,
            passed: isCorrect,
            feedback: isCorrect
              ? 'Correct.'
              : `Incorrect. The correct answer was: ${q.correct_answer}`,
            gap: isCorrect ? null : 'Review this concept in the lesson.',
            false_confidence: false,
          },
        }
      }

      const isCodeQuestion = q.type === 'code'
      const codeEvaluationRules = isCodeQuestion
        ? `
FOR CODE QUESTIONS:
- Evaluate the code by reading it carefully. Do not require one exact solution, exact variable names, or perfect style.
- Passing code should satisfy the required behavior and show the lesson concept in use.
- Catch code that looks plausible but would not produce the required behavior.
- Catch missing edge cases, incorrect data flow, syntax misunderstandings, or misuse of the language/API.
- If the code is partial, explain the smallest conceptual or implementation issue to fix next.`
        : ''

      const prompt = {
        system: `You are TruLurn's answer evaluator. Grade the student's answer strictly against the question and rubric.

GRADING SCALE:
1 — Recognition: student identifies a keyword or fact but shows no understanding of what it means
2 — Mechanical: student repeats a definition or formula without any evidence of understanding why
3 — Conceptual: student demonstrates the mechanism, not just the result — PASSING THRESHOLD
4 — Transfer: student applies reasoning to aspects not directly stated in the lesson
5 — Intuitive: student shows fluent understanding and can reason about edge cases or implications

WHAT TO CATCH:
• Answers that sound confident but are vague or circular
• Correct vocabulary used without correct reasoning
• Restating the question as the answer
• Describing WHAT without explaining HOW or WHY

${codeEvaluationRules}

Return ONLY valid JSON:
{
  "level": 1,
  "passed": false,
  "feedback": "1–3 sentence constructive note: what they showed, what was missing",
  "gap": "the specific conceptual gap, or null if level >= 3",
  "false_confidence": false
}`,
        user: `Topic: ${topic.title}
Question type: ${q.type}
Question: ${q.question}
Rubric: ${q.rubric || 'Evaluate whether the student demonstrates mechanism-level understanding.'}
Student answer:
${isCodeQuestion ? `\`\`\`
${studentAnswer || '(no answer given)'}
\`\`\`` : `${studentAnswer || '(no answer given)'}`}`,
      }

      try {
        const geminiText = await generateWithGemini({ ...prompt, purpose: 'agent' })
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
      course_id: courseId,
      topic_id: topicId,
      user_id: userId,
      questions_asked: questions.map((q) => q._id),
      answers: answers,
      evaluation: evaluationMap,
      overall_level: overallLevel,
      passed: passed,
      created_at: new Date(),
    })

    // 6. Unlock next roadmap nodes (deterministic prerequisite check)
    if (passed) {
      await unlockNextTopics(courseId, topicId)

      // Background pre-generation: generate page 1 of every newly-unlocked topic.
      // Fire-and-forget — never block the quiz response.
      ;(async () => {
        try {
          const course = await db.collection('courses').findOne({ _id: courseId as any })
          const freshTopics = await db.collection('topics')
            .find({ course_id: courseId, state: 'active' })
            .toArray()

          for (const t of freshTopics) {
            const tid = String(t._id)
            // Skip the topic we just quizzed, and skip topics that already have page 1
            if (tid === topicId) continue
            const existingPage = await db.collection('pages').findOne({
              course_id: courseId,
              topic_id: tid,
              page_number: 1,
            })
            if (existingPage) continue

            // Generate page 1 for this newly-unlocked topic
            try {
              const nextMemory = await retrieveCourseMemory({
                db,
                query: `${t.title} ${t.description ?? t.summary ?? ''}`,
                courseId,
                userId,
                currentTopicId: tid,
                pageLimit: 3,
                doubtLimit: 3,
                sourceLimit: 3,
              })
              const generated = await generateTopicPage({
                course,
                topic: t,
                pageNumber: 1,
                memory: nextMemory,
              })
              const doc = buildPageDocument({ courseId, topicId: tid, userId, page: generated })
              await db.collection('pages').insertOne(doc)
              await db.collection('pageSummaries').insertOne({
                _id: `${doc._id}:summary` as any,
                course_id: courseId,
                topic_id: tid,
                page_id: String(doc._id),
                user_id: userId,
                page_number: 1,
                focus: generated.focus,
                summary: generated.summary,
                key_concepts: generated.key_concepts,
                created_at: new Date(),
              })
              embedPageById(db, String(doc._id)).catch((error) => {
                console.warn('[quiz/evaluate] Failed to embed pre-generated page.', error)
              })
            } catch (genErr) {
              console.warn(`[quiz/evaluate] Pre-generation failed for topic ${tid}:`, genErr)
            }

          }
        } catch (bgErr) {
          console.warn('[quiz/evaluate] Background pre-generation error:', bgErr)
        }
      })()
    }

    // 7. AI graph update — runs after unlock so snapshot is fresh
    let graphUpdate = null
    try {
      const allTopics = await db.collection('topics').find({ course_id: courseId }).toArray()
      const weakGaps = evalResults
        .filter((r) => !r.evaluation.passed && r.evaluation.gap)
        .map((r) => r.evaluation.gap as string)

      const event = {
        topicId,
        topicTitle: topic.title,
        passed,
        overallLevel,
        hasFalseConfidence: evalResults.some((r) => r.evaluation.false_confidence),
        questionsCount: questions.length,
        weakGaps,
      }

      const snapshot = allTopics.map((t) => ({
        id: String(t._id),
        title: t.title,
        state: t.state,
        mastery: t.understanding_level ? t.understanding_level * 20 : 0,
        prerequisites: (t.prerequisites || []) as string[],
      }))

      graphUpdate = await evaluateQuizForGraph(event, snapshot)

      // Apply the graph updates to MongoDB
      for (const upd of graphUpdate.updates) {
        const $set: Record<string, unknown> = { updated_at: new Date() }
        if (upd.state !== undefined)         $set.state = upd.state
        if (upd.mastery !== undefined)       $set.understanding_level = Math.round(upd.mastery / 20)
        if (upd.misconception !== undefined) $set.misconception = upd.misconception
        if (upd.suggested !== undefined)     $set.suggested = upd.suggested
        await db.collection('topics').updateOne(
          { _id: upd.topicId as any, course_id: courseId },
          { $set },
        )
      }

      // Clear all other 'suggested' flags and set the new one
      if (graphUpdate.nextSuggestedTopicId) {
        await db.collection('topics').updateMany(
          { course_id: courseId, _id: { $ne: graphUpdate.nextSuggestedTopicId as any } },
          { $set: { suggested: false } },
        )
      }

      // Unlock AI-suggested topics
      for (const unlockId of graphUpdate.unlocked) {
        await db.collection('topics').updateOne(
          { _id: unlockId as any, course_id: courseId, state: 'locked' },
          { $set: { state: 'active', updated_at: new Date() } },
        )
      }
    } catch (graphErr) {
      // Non-fatal: quiz result still returned, graph update logged
      console.warn('[quiz/evaluate] Graph update failed:', graphErr)
    }

    return NextResponse.json({
      evaluations: evaluationMap,
      passed,
      graphUpdate: graphUpdate
        ? { summary: graphUpdate.summary, nextSuggestedTopicId: graphUpdate.nextSuggestedTopicId }
        : null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown quiz evaluation error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
