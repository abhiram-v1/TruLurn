import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { createRecallSession, type RecallSessionDoc } from '@/lib/recall/generateRecallPage'
import { buildAudienceDirective } from '@/lib/personalization/learnerAudience'
import { buildPersonaDirective, resolveCourseTeachingPersona } from '@/lib/personas'
import { getRecallBreakMode, snoozeBreak, type StudySessionDoc } from '@/lib/recall/session'
import { retrieveCourseSkillContext } from '@/lib/course-skills/context'
import { COMPACT_CHART_OUTPUT_CONTRACT } from '@/lib/ai/skills/dataChart'
import { apiUsageErrorResponse, consumeApiUsage } from '@/lib/server/apiUsage'

function serializeRecallSession(doc: RecallSessionDoc, taggedItemIds: Set<string>) {
  return {
    id: doc._id,
    headline: doc.headline,
    summaries: [],
    items: doc.items.map((item) => ({
      id: item.id,
      type: item.type,
      concept: item.concept,
      prompt: item.prompt,
      topicId: item.topic_id,
      topicTitle: item.topic_title,
      pageNumber: item.page_number,
      tagged: taggedItemIds.has(item.id),
    })),
  }
}

// POST /api/recall/break
// action: "start"  → generate (or resume) the recall page for the current stretch
// action: "snooze" → suppress the break prompt for a bounded custom delay
// action: "skip"   → dismiss this suggestion and reconsider at a later point
export async function POST(request: Request) {
  try {
    const userId = await getRequiredUserId()
    const body = await request.json()
    const courseId = String(body.courseId ?? '')
    const action = String(body.action ?? 'start')

    if (!courseId) {
      return NextResponse.json({ error: 'courseId is required.' }, { status: 400 })
    }

    const db = await getDb()
    const course = await db.collection('courses').findOne(
      { _id: courseId as any, user_id: userId },
      {
        projection: {
          title: 1,
          topic: 1,
          goals: 1,
          teaching_persona: 1,
          learner_audience: 1,
          learner_persona: 1,
          course_skill_keys: 1,
          skill_set_keys: 1,
          course_skill_key: 1,
          skill_set_key: 1,
        },
      },
    )
    if (!course) {
      return NextResponse.json({ error: 'Course not found.' }, { status: 404 })
    }

    const session = await db.collection<StudySessionDoc>('studySessions').findOne({
      user_id: userId,
      course_id: courseId,
      status: 'active',
    })
    if (!session) {
      return NextResponse.json({ error: 'No active study session for this course yet.' }, { status: 404 })
    }

    if (action === 'snooze' || action === 'skip') {
      const requestedMinutes = action === 'skip' ? 20 : Number(body.minutes ?? 5)
      const minutes = Number.isFinite(requestedMinutes)
        ? Math.min(120, Math.max(1, Math.round(requestedMinutes)))
        : 5
      await snoozeBreak({ db, sessionId: session._id, userId, minutes })
      return NextResponse.json({ snoozed: true, skipped: action === 'skip', minutes })
    }

    const mode = await getRecallBreakMode(db, userId)
    const trigger: RecallSessionDoc['trigger'] = body.manual ? 'manual' : mode === 'off' ? 'manual' : mode
    const courseSkillContext = await retrieveCourseSkillContext({
      db,
      course,
      query: `${course.title ?? course.topic ?? 'Course'} recall`,
      surface: 'recall',
    }).catch((error) => {
      console.warn('[recall] Course skill context unavailable.', error)
      return null
    })

    await consumeApiUsage({ userId, bucket: 'learning_tools', scope: 'ai-tools', db })

    const recallSession = await createRecallSession({
      db,
      session,
      courseTitle: String(course.title ?? course.topic ?? 'Course'),
      trigger,
      audienceDirective: [
        buildPersonaDirective({
          persona: resolveCourseTeachingPersona(course),
          surface: 'recall',
        }),
        courseSkillContext?.text,
        COMPACT_CHART_OUTPUT_CONTRACT,
        buildAudienceDirective(course.learner_audience ?? course.learner_persona, course.goals),
      ].filter(Boolean).join('\n\n'),
    })
    const tagged = await db.collection('taggedReminders').find(
      {
        user_id: userId,
        course_id: courseId,
        recall_session_id: recallSession._id,
      },
      { projection: { recall_item_id: 1 } },
    ).toArray()
    const taggedItemIds = new Set(tagged.map((item) => String(item.recall_item_id)))

    return NextResponse.json({ recall: serializeRecallSession(recallSession, taggedItemIds) })
  } catch (error) {
    const limited = apiUsageErrorResponse(error)
    if (limited) return limited
    const message = error instanceof Error ? error.message : 'Could not start the recall break.'
    const status = message.includes('sign in') ? 401 : message.includes('Nothing new') ? 409 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
