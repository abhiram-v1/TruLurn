import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { getCachedCourse, getCachedTopicPages } from '@/lib/cache/courseData'

export async function GET(
  _req: NextRequest,
  { params }: { params: { topicId: string; pageNumber: string } },
) {
  try {
    const userId = await getRequiredUserId()
    const db = await getDb()

    const topicId = decodeURIComponent(params.topicId)
    const pageNumber = parseInt(params.pageNumber, 10)

    if (!Number.isFinite(pageNumber) || pageNumber < 1) {
      return NextResponse.json({ error: 'Invalid page number' }, { status: 400 })
    }

    // Verify ownership via the topic → course chain
    const topic = await db.collection('topics').findOne(
      { _id: topicId as any },
      { projection: { course_id: 1, planned_pages: 1, estimated_pages: 1, total_pages_planned: 1 } },
    )
    if (!topic) {
      return NextResponse.json({ error: 'Topic not found' }, { status: 404 })
    }

    const courseId = String(topic.course_id)
    const course = await getCachedCourse(db, courseId, userId)
    if (!course) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Fetch the pages from cache
    const topicPages = await getCachedTopicPages(db, courseId, topicId)
    const storedPage = topicPages.find((p: any) => p.page_number === pageNumber) ?? null
    if (!storedPage) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 })
    }

    // Total stored count — from cache
    const totalPages = topicPages.length

    const plannedPages = Number(topic.planned_pages) > 0 ? Number(topic.planned_pages) : null
    const estimatedPages = Math.max(
      1,
      plannedPages ?? Number(topic.estimated_pages ?? topic.total_pages_planned ?? 1),
    )
    const page = {
      id: String(storedPage._id),
      topic_id: String(storedPage.topic_id),
      page_number: storedPage.page_number,
      content: storedPage.content,
      created_at: storedPage.created_at.toISOString(),
      key_concepts: Array.isArray(storedPage.key_concepts)
        ? storedPage.key_concepts.map(String)
        : undefined,
      summary: storedPage.summary ? String(storedPage.summary) : null,
      topic_depth: storedPage.topic_depth ?? undefined,
      concept_kind: storedPage.concept_kind ?? undefined,
      content_kind: storedPage.content_kind ?? undefined,
      should_generate_page: storedPage.should_generate_page ?? undefined,
      decision_reason: storedPage.decision_reason ?? undefined,
      estimated_length: storedPage.estimated_length ?? undefined,
      requires_quiz: storedPage.requires_quiz ?? undefined,
      covered_concepts: Array.isArray(storedPage.covered_concepts)
        ? storedPage.covered_concepts.map(String)
        : undefined,
      reused_concepts: Array.isArray(storedPage.reused_concepts)
        ? storedPage.reused_concepts.map(String)
        : undefined,
      reminder_concepts: Array.isArray(storedPage.reminder_concepts)
        ? storedPage.reminder_concepts.map(String)
        : undefined,
      example_refs: Array.isArray(storedPage.example_refs) ? storedPage.example_refs : undefined,
      sections: Array.isArray(storedPage.sections) ? storedPage.sections : undefined,
      source_citations: Array.isArray(storedPage.source_citations)
        ? storedPage.source_citations
        : undefined,
      figures: Array.isArray(storedPage.figures) ? storedPage.figures : undefined,
      grounding: storedPage.grounding ?? null,
    }

    return NextResponse.json({ page, totalPages, estimatedPages })
  } catch (err) {
    console.error('[pages/[pageNumber]] GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
