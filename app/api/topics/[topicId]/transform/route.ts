import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { generateAI } from '@/lib/ai'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { buildPersonaDirective, resolveCourseTeachingPersona } from '@/lib/personas'
import { retrieveCourseSkillContext } from '@/lib/course-skills/context'
import { COMPACT_CHART_OUTPUT_CONTRACT } from '@/lib/ai/skills/dataChart'

type TransformAction = 'simplify' | 'deeper' | 'example'

const SYSTEM: Record<TransformAction, string> = {
  simplify: `You are TruLurn's lesson editor. Rewrite a selected passage in simpler, clearer language.
Rules:
- Preserve every concept — never drop an idea, only lower the vocabulary and sentence complexity
- Use shorter sentences. Prefer plain words over technical synonyms where possible
- Keep all math exactly as given (do not simplify or approximate LaTeX expressions)
- Write in the same style as the surrounding lesson (clear, direct, not chatty)
- Return clean Markdown only. No preamble, no "Here is the simplified version" prefix`,

  deeper: `You are TruLurn's lesson editor. Expand on a selected passage with one level more depth.
Rules:
- Explain the mechanism or reasoning behind the statement, not just what it says
- Add one concrete layer of precision: the why, the edge case, the underlying model
- Stay tightly scoped — do not drift to adjacent topics
- Use math where it sharpens the point
- Return clean Markdown only. No preamble`,

  example: `You are TruLurn's lesson editor. Generate one concrete example that illustrates a selected passage.
Rules:
- Use real numbers, a specific scenario, or a step-by-step worked case
- One excellent example — not a list of examples
- Show math with LaTeX when it helps the example
- Keep it tight: 3–8 sentences or a compact worked solution
- Return clean Markdown only. No preamble`,
}

function buildUserPrompt(action: TransformAction, selectedText: string, topicTitle: string) {
  const instructions = {
    simplify: 'Rewrite this in simpler language without losing any concept.',
    deeper:   'Expand this with one level more depth and precision.',
    example:  'Generate one concrete example that makes this clear.',
  }
  return `Topic: ${topicTitle}

Selected passage:
${selectedText}

${instructions[action]}`
}

export async function POST(
  request: Request,
  { params }: { params: { topicId: string } },
) {
  try {
    const body = await request.json() as {
      courseId?: string
      action?: string
      selectedText?: string
      topicTitle?: string
    }

    const { courseId, action, selectedText, topicTitle } = body

    if (!courseId || !action || !selectedText?.trim()) {
      return NextResponse.json({ error: 'courseId, action, and selectedText are required.' }, { status: 400 })
    }

    if (!['simplify', 'deeper', 'example'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action.' }, { status: 400 })
    }

    const db = await getDb()
    const userId = await getRequiredUserId()
    const course = await db.collection('courses').findOne({ _id: courseId as any, user_id: userId })

    if (!course) {
      return NextResponse.json({ error: 'Course not found.' }, { status: 404 })
    }

    const typedAction = action as TransformAction
    const courseSkillContext = await retrieveCourseSkillContext({
      db,
      course,
      query: `${topicTitle ?? 'current topic'} | ${selectedText.trim()}`,
      surface: 'lesson',
    }).catch((error) => {
      console.warn('[transform] Course skill context unavailable.', error)
      return null
    })
    const result = await generateAI({
      feature: 'topic_transform',
      system: [
        SYSTEM[typedAction],
        buildPersonaDirective({
          persona: resolveCourseTeachingPersona(course),
          surface: 'lesson',
          lesson: {
            contentKind: 'section',
            focus: topicTitle ?? 'the current topic',
          },
        }),
        courseSkillContext?.text,
        typedAction === 'simplify' ? null : COMPACT_CHART_OUTPUT_CONTRACT,
      ].filter(Boolean).join('\n\n'),
      user: buildUserPrompt(typedAction, selectedText.trim(), topicTitle ?? 'the current topic'),
      responseMimeType: 'text/plain',
    })

    return NextResponse.json({ result: result.trim() })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Transform failed.'
    const status = message.includes('sign in') ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
