import type { Db } from 'mongodb'
import { generateWithGemini } from '@/lib/ai/gemini/client'
import { parseGeminiJson } from '@/lib/ai/gemini/json'

// Per-session question count: conceptual courses get explain; programming courses get code.
export const QUIZ_SESSION_SIZE = 5

type RawQuestion = {
  type: 'apply' | 'spot_error' | 'explain' | 'mcq' | 'true_false' | 'code'
  question: string
  options: string[] | null
  correct_answer: string | null
  rubric: string | null
}

function compact(text: string, max: number) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}...` : clean
}

function isProgrammingQuiz(course: any, topic: any, lessonContext: string) {
  const source = [
    course?.title,
    course?.topic,
    course?.goals,
    topic?.title,
    topic?.description,
    topic?.summary,
    lessonContext.slice(0, 6000),
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase()

  return /\b(code|coding|programming|program|function|class|method|variable|algorithm|data structure|debug|syntax|python|javascript|typescript|java|c\+\+|c#|react|node|sql|html|css|api|compiler|runtime)\b/.test(source)
}

function normalizeQuizQuestions(questions: any[], allowCode: boolean): RawQuestion[] {
  const allowed = new Set(['apply', 'spot_error', 'explain', 'mcq', 'true_false'])
  if (allowCode) allowed.add('code')

  return questions
    .filter((q) => q && allowed.has(String(q.type)))
    .slice(0, QUIZ_SESSION_SIZE)
    .map((q) => ({
      type: String(q.type) as RawQuestion['type'],
      question: String(q.question ?? '').trim(),
      options: Array.isArray(q.options) ? q.options.map(String).slice(0, 4) : null,
      correct_answer: q.correct_answer == null ? null : String(q.correct_answer),
      rubric: q.rubric == null ? null : String(q.rubric),
    }))
    .filter((q) => q.question)
}

export async function buildQuizTopicContext(
  db: Db,
  courseId: string,
  topicId: string,
  userId: string,
) {
  const [pages, summaries, doubts] = await Promise.all([
    db.collection('pages')
      .find({ course_id: courseId, topic_id: topicId })
      .sort({ page_number: 1 })
      .toArray(),
    db.collection('pageSummaries')
      .find({ course_id: courseId, topic_id: topicId })
      .sort({ page_number: 1 })
      .toArray(),
    db.collection('doubtMessages')
      .find({ course_id: courseId, topic_id: topicId, user_id: userId })
      .sort({ created_at: 1 })
      .limit(12)
      .toArray(),
  ])

  const summaryByPage = new Map<number, any>(summaries.map((s: any) => [s.page_number as number, s]))

  const lessonContext = pages.map((page: any) => {
    const summary: any = summaryByPage.get(page.page_number as number)
    const parts: string[] = []
    if (pages.length > 1) parts.push(`=== Page ${page.page_number} ===`)
    if (summary?.focus) parts.push(`Focus: ${String(summary.focus)}`)
    if (Array.isArray(summary?.key_concepts) && summary.key_concepts.length) {
      parts.push(`Key concepts: ${(summary.key_concepts as string[]).join(', ')}`)
    }
    if (Array.isArray(page.sections) && page.sections.length > 0) {
      for (const section of page.sections) {
        const content = compact(String(section.content ?? ''), 1400)
        if (content) parts.push(`[${section.type}]\n${content}`)
      }
    } else {
      parts.push(compact(String(page.content ?? ''), 2200))
    }
    return parts.join('\n')
  }).join('\n\n')

  const doubtContext = doubts.length
    ? doubts
        .map((d: any) => `${d.role === 'user' ? 'Student' : 'Tutor'}: ${compact(String(d.content ?? ''), 280)}`)
        .join('\n')
    : ''

  return { lessonContext, doubtContext, pageCount: pages.length }
}

export async function generateQuizQuestions(
  db: Db,
  course: any,
  topic: any,
  userId: string,
): Promise<RawQuestion[]> {
  const courseId = String(course._id)
  const topicId = String(topic._id)
  const { lessonContext, doubtContext, pageCount } = await buildQuizTopicContext(
    db, courseId, topicId, userId,
  )

  if (!lessonContext.trim() || pageCount === 0) {
    throw new Error('No lesson content found. Study the topic before taking the quiz.')
  }

  const allowCode = isProgrammingQuiz(course, topic, lessonContext)
  const finalQuestionSpec = allowCode
    ? '- 1 x "code": Ask the student to write, complete, or fix a small code snippet directly related to the lesson. The task must be runnable in principle, bounded to about 8-25 lines, and specify the language if the lesson implies one. Set options and correct_answer to null.'
    : '- 1 x "explain": Ask the student to explain a specific causal mechanism from the lesson. Must target a different relationship than the apply question. Set options and correct_answer to null.'
  const finalRubricType = allowCode ? 'code' : 'explain'

  const system = `You are TruLurn's quiz question writer. Write exactly ${QUIZ_SESSION_SIZE} diagnostic questions that reveal whether a student truly understands this topic, not whether they memorized it.

WHAT MAKES A GOOD QUESTION:
- Grounded: rooted in the specific lesson content. Do not ask about things not covered.
- Hard: requires active reasoning. A student who read but did not understand the mechanism should fail.
- Specific: use concrete numbers, named concepts, and specific scenarios. Never use generic academic wording.
- Mechanism-first: test WHY or HOW, never just WHAT.

QUESTION TYPES: generate exactly one of each, in any order:
- 1 x "mcq": Write a question with 4 options. The 3 wrong distractors must be genuinely plausible: at least one should swap cause and effect, one should use correct vocabulary with wrong reasoning. A student who read but did not understand the mechanism should hesitate on at least two distractors. Set correct_answer to the exact string of the correct option. Set rubric to null.
- 1 x "true_false": Write a statement that is definitively true or false and requires mechanism-level understanding to evaluate correctly. Set correct_answer to "true" or "false". Set options and rubric to null.
- 1 x "apply": Give a new concrete scenario not found in the lesson. Student must apply the mechanism, not recall it. Set options and correct_answer to null.
- 1 x "spot_error": Write a plausible argument, explanation, or code snippet containing one subtle mistake. Requires deep understanding to catch. Set options and correct_answer to null.
${finalQuestionSpec}

RUBRIC REQUIREMENTS for apply, spot_error, and ${finalRubricType}:
Each rubric must list: 2-3 specific concepts/terms that must appear, the causal relationship or implementation behavior that must be demonstrated, and what an incomplete answer typically misses.
For "code", the rubric must include expected behavior, required language feature or API, edge cases to consider, and common implementation mistakes. Do not require exact formatting or a single exact solution.

Return ONLY a valid JSON array of exactly ${QUIZ_SESSION_SIZE} objects:
[
  {
    "type": "mcq",
    "question": "...",
    "options": ["Option A text", "Option B text", "Option C text", "Option D text"],
    "correct_answer": "Option A text",
    "rubric": null
  },
  {
    "type": "true_false",
    "question": "Statement to evaluate...",
    "options": null,
    "correct_answer": "true",
    "rubric": null
  },
  {
    "type": "${allowCode ? 'code' : 'apply'}",
    "question": "...",
    "options": null,
    "correct_answer": null,
    "rubric": "Strong answer must: [checklist]. Common incomplete answer: [what is missing]."
  }
]`

  const user = `Course: ${course.title ?? course.topic}
Topic: ${topic.title}
Topic depth: ${topic.depth ?? 'medium'}
Course goals: ${course.goals ?? 'Understand the subject clearly enough to explain and apply it.'}

FULL LESSON CONTENT TAUGHT:
${lessonContext}
${doubtContext ? `\nSTUDENT'S PRIOR DOUBTS ON THIS TOPIC (use to target the quiz):\n${doubtContext}` : ''}`

  const raw = await generateWithGemini({ system, user, purpose: 'primary', responseMimeType: 'text/plain' })
  const questions = parseGeminiJson<any[]>(raw)

  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('Quiz generation returned an invalid response.')
  }

  const normalized = normalizeQuizQuestions(questions, allowCode)

  if (normalized.length !== QUIZ_SESSION_SIZE) {
    throw new Error('Quiz generation returned the wrong question structure.')
  }

  return normalized
}
