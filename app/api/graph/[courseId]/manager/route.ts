// Async graph manager endpoint.
// Called fire-and-forget by the client after receiving is_update_graph=true.
// Analyzes the interaction and evolves the knowledge graph without blocking
// the user-facing agent response.

export const dynamic = 'force-dynamic'
export const maxDuration = 30

import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { analyzeInteractionForGraph } from '@/lib/graph/interactionAnalyzer'
import { updateGraphFromInteraction } from '@/lib/graph/manager'

export async function POST(
  request: Request,
  { params }: { params: { courseId: string } },
) {
  try {
    const userId = await getRequiredUserId()
    const { courseId } = params
    const body = await request.json() as {
      message: string
      topicId: string
      topicTitle?: string
      courseTitle?: string
      source?: 'doubt' | 'feedback' | 'discussion' | 'action'
      interactionId?: string
    }

    if (!body.message?.trim() || !body.topicId) {
      return NextResponse.json({ ok: false, reason: 'missing_fields' }, { status: 400 })
    }

    const [db] = await Promise.all([getDb()])

    const course = await db.collection('courses').findOne({ _id: courseId as any, user_id: userId })
    if (!course) return NextResponse.json({ error: 'Course not found.' }, { status: 404 })

    const analysis = await analyzeInteractionForGraph({
      message: body.message,
      topicTitle: body.topicTitle ?? '',
      courseTitle: body.courseTitle ?? String(course.title ?? course.topic ?? ''),
      source: body.source ?? 'doubt',
    })

    if (analysis.is_update_graph) {
      await updateGraphFromInteraction({
        db,
        userId,
        courseId,
        topicId: body.topicId,
        analysis,
        interactionId: body.interactionId,
      })
    }

    return NextResponse.json({ ok: true, is_update_graph: analysis.is_update_graph })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    const status = message.includes('sign in') ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
