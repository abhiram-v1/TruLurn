import nextEnv from '@next/env'

nextEnv.loadEnvConfig(process.cwd(), true, console, true)

const { generateAI, parseAIJson } = await import('../lib/ai/index.ts')
const { validateQuizQuestion } = await import('../lib/quiz/questionQuality.ts')
const { buildLessonFeedbackDirective } = await import('../lib/learning/lessonFeedback.ts')

type FixtureType = 'mcq' | 'true_false' | 'apply'
type Fixture = { type: FixtureType; concept: string; lesson: string }

const fixtures: Fixture[] = [
  {
    type: 'mcq',
    concept: 'gradient descent step size',
    lesson: 'Gradient descent follows the local negative gradient. A learning rate that is too large can overshoot a minimum; one that is too small can make progress impractically slow.',
  },
  {
    type: 'true_false',
    concept: 'serializable isolation',
    lesson: 'Serializable isolation requires the concurrent result to be equivalent to some serial ordering. It prevents anomalies that cannot occur in any serial execution.',
  },
  {
    type: 'apply',
    concept: 'cache request coalescing',
    lesson: 'Request coalescing allows one request to refresh an expired cache entry while concurrent requests await or share that in-flight work, preventing a stampede on the downstream service.',
  },
]

async function generateQuizFixture(fixture: Fixture) {
  const objective = fixture.type === 'mcq' || fixture.type === 'true_false'
  let repair = ''
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const raw = await generateAI({
      feature: 'exam_question_generation',
      system: `Write one reasoning-first ${fixture.type} question using only the supplied lesson. It must be unambiguous, concrete, and diagnostic rather than a definition lookup.
For MCQ, use four plausible options and make correct_answer exactly match one option.
For true_false, set correct_answer to "true" or "false".
For open responses, set options and correct_answer to null.
Always provide a specific rubric and an answer_explanation. Return JSON only.`,
      user: `Concept: ${fixture.concept}\nLesson: ${fixture.lesson}${repair}`,
      responseMimeType: 'text/plain',
      responseSchema: {
        name: 'generation_beta_quiz_fixture',
        schema: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            question: { type: 'string' },
            options: { type: ['array', 'null'], items: { type: 'string' } },
            correct_answer: { type: ['string', 'null'] },
            answer_explanation: { type: ['string', 'null'] },
            rubric: { type: ['string', 'null'] },
          },
          required: ['type', 'question', 'options', 'correct_answer', 'answer_explanation', 'rubric'],
        },
      },
    })
    const parsed = parseAIJson<any>(raw)
    const draft = {
      type: fixture.type,
      question: String(parsed.question ?? ''),
      options: Array.isArray(parsed.options) ? parsed.options.map(String) : null,
      correct_answer: objective && parsed.correct_answer != null ? String(parsed.correct_answer) : null,
      answer_explanation: parsed.answer_explanation == null ? null : String(parsed.answer_explanation),
      rubric: parsed.rubric == null ? null : String(parsed.rubric),
    }
    const issues = validateQuizQuestion(draft)
    if (issues.length) {
      repair = `\nRepair these failures:\n${issues.map((issue) => `- ${issue.message}`).join('\n')}`
      if (attempt < 2) continue
      throw new Error(`${fixture.type} failed deterministic review: ${repair}`)
    }

    const reviewRaw = await generateAI({
      feature: 'exam_question_validation',
      system: 'Verify that the candidate is supported by the lesson, unambiguous, non-trivial, and has the correct stored answer. Return JSON only.',
      user: `Lesson: ${fixture.lesson}\nCandidate: ${JSON.stringify(draft)}`,
      responseMimeType: 'text/plain',
      responseSchema: {
        name: 'generation_beta_quiz_review',
        schema: {
          type: 'object',
          properties: {
            accepted: { type: 'boolean' },
            reason: { type: 'string' },
          },
          required: ['accepted', 'reason'],
        },
      },
    })
    const review = parseAIJson<any>(reviewRaw)
    if (!review.accepted) throw new Error(`${fixture.type} failed semantic review: ${String(review.reason)}`)
    return { fixture: fixture.type, question: draft.question, review: String(review.reason) }
  }
  throw new Error(`${fixture.type} generation exhausted its attempts.`)
}

async function runLessonAdaptationFixture() {
  const feedback = buildLessonFeedbackDirective({
    feedback_last_signal: 'lost_me',
    feedback_last_reason: 'Needed an example',
  })
  const lesson = await generateAI({
    feature: 'topic_page_generation',
    system: 'Write a concise lesson excerpt. Follow the learner-feedback adaptation while staying inside the exact topic scope. Begin teaching immediately and end with one self-check question.',
    user: `Topic scope: Preventing a cache stampede with request coalescing.\n${feedback}`,
    responseMimeType: 'text/plain',
    reasoningEffort: 'medium',
  })
  const reviewRaw = await generateAI({
    feature: 'page_analysis',
    system: 'Check whether the lesson stays on scope, uses a concrete worked example before or alongside abstraction, explains the mechanism, and ends with a useful self-check. Return JSON only.',
    user: lesson,
    responseMimeType: 'text/plain',
    responseSchema: {
      name: 'generation_beta_lesson_review',
      schema: {
        type: 'object',
        properties: {
          accepted: { type: 'boolean' },
          checks: { type: 'array', items: { type: 'string' } },
        },
        required: ['accepted', 'checks'],
      },
    },
  })
  const review = parseAIJson<any>(reviewRaw)
  if (!review.accepted) throw new Error(`Lesson adaptation failed semantic review: ${JSON.stringify(review.checks)}`)
  return { fixture: 'lesson_feedback_adaptation', checks: review.checks }
}

const quizResults = []
for (const fixture of fixtures) quizResults.push(await generateQuizFixture(fixture))
const lessonResult = await runLessonAdaptationFixture()

console.log(JSON.stringify({ passed: true, quizResults, lessonResult }, null, 2))
