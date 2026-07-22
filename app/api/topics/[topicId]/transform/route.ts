import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { generateAI } from '@/lib/ai'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { buildPersonaDirective } from '@/lib/personas'
import { retrieveCourseSkillContext } from '@/lib/course-skills/context'
import { COMPACT_CHART_OUTPUT_CONTRACT } from '@/lib/ai/skills/dataChart'
import {
  buildTransformUserPrompt,
  buildTransformSystem,
  validateTransformResult,
  type TransformAction,
} from '@/lib/topic-transform'

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
      contextBefore?: string
      contextAfter?: string
    }

    const { courseId, action, selectedText, topicTitle, contextBefore, contextAfter } = body

    if (!courseId || !action || !selectedText?.trim()) {
      return NextResponse.json({ error: 'courseId, action, and selectedText are required.' }, { status: 400 })
    }

    if (!['simplify', 'deeper', 'example'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action.' }, { status: 400 })
    }

    if (selectedText.length > 6000) {
      return NextResponse.json({ error: 'Select a shorter passage (6,000 characters or fewer).' }, { status: 400 })
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
    const basePrompt = buildTransformUserPrompt({
      action: typedAction,
      selectedText: selectedText.trim(),
      topicTitle: topicTitle ?? 'the current topic',
      contextBefore: contextBefore?.slice(-240),
      contextAfter: contextAfter?.slice(0, 240),
    })
    let repair = ''
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const result = (await generateAI({
        feature: 'topic_transform',
        system: [
          buildTransformSystem(typedAction),
          buildPersonaDirective({
            surface: 'lesson',
            lesson: {
              contentKind: 'section',
              focus: topicTitle ?? 'the current topic',
            },
          }),
          courseSkillContext?.text,
          typedAction === 'simplify' ? null : COMPACT_CHART_OUTPUT_CONTRACT,
        ].filter(Boolean).join('\n\n'),
        user: `${basePrompt}${repair}`,
        responseMimeType: 'text/plain',
      })).trim()
      const issues = validateTransformResult(typedAction, selectedText, result, {
        before: contextBefore,
        after: contextAfter,
      })
      if (issues.length === 0) return NextResponse.json({ result })
      repair = `\n\nYour previous candidate failed these checks:\n${issues.map((issue) => `- ${issue}`).join('\n')}\nWrite a corrected replacement only.`
    }

    throw new Error('The transform could not produce a safe in-place replacement after two attempts.')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Transform failed.'
    const status = message.includes('sign in') ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
