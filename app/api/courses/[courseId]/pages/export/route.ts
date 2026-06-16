import { NextResponse } from 'next/server'
import { computeGlobalPagePosition, sortCourseTopics } from '@/lib/course-pages/globalPageNumbers'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'

function serializePage(storedPage: any) {
  return {
    id: String(storedPage._id),
    topic_id: String(storedPage.topic_id),
    page_number: storedPage.page_number,
    content: storedPage.content,
    created_at: storedPage.created_at.toISOString(),
    key_concepts: Array.isArray(storedPage.key_concepts) ? storedPage.key_concepts.map(String) : undefined,
    summary: storedPage.summary ? String(storedPage.summary) : null,
    topic_depth: storedPage.topic_depth ?? undefined,
    concept_kind: storedPage.concept_kind ?? undefined,
    content_kind: storedPage.content_kind ?? undefined,
    should_generate_page: storedPage.should_generate_page ?? undefined,
    decision_reason: storedPage.decision_reason ?? undefined,
    estimated_length: storedPage.estimated_length ?? undefined,
    requires_quiz: storedPage.requires_quiz ?? undefined,
    covered_concepts: Array.isArray(storedPage.covered_concepts) ? storedPage.covered_concepts.map(String) : undefined,
    reused_concepts: Array.isArray(storedPage.reused_concepts) ? storedPage.reused_concepts.map(String) : undefined,
    reminder_concepts: Array.isArray(storedPage.reminder_concepts) ? storedPage.reminder_concepts.map(String) : undefined,
    example_refs: Array.isArray(storedPage.example_refs) ? storedPage.example_refs : undefined,
    sections: Array.isArray(storedPage.sections) ? storedPage.sections : undefined,
    source_citations: Array.isArray(storedPage.source_citations) ? storedPage.source_citations : undefined,
    grounding: storedPage.grounding ?? null,
  }
}

function hasRenderableContent(storedPage: any) {
  const content = String(storedPage?.content ?? '').trim()
  const sectionContent = Array.isArray(storedPage?.sections)
    ? storedPage.sections.map((section: any) => String(section?.content ?? '').trim()).join('')
    : ''
  return content.length >= 60 || sectionContent.length >= 60
}

export async function GET(
  _request: Request,
  { params }: { params: { courseId: string } },
) {
  try {
    const courseId = params.courseId?.trim()
    if (!courseId) {
      return NextResponse.json({ error: 'courseId is required.' }, { status: 400 })
    }

    const [db, userId] = await Promise.all([getDb(), getRequiredUserId()])
    const course = await db.collection('courses').findOne({
      _id: courseId as any,
      user_id: userId,
    })
    if (!course) {
      return NextResponse.json({ error: 'Course not found.' }, { status: 404 })
    }

    const [topics, branches, storedPages] = await Promise.all([
      db.collection('topics').find({ course_id: courseId }).toArray(),
      db.collection('branches').find({ course_id: courseId }).toArray(),
      db.collection('pages')
        .find({ course_id: courseId })
        .sort({ topic_id: 1, page_number: 1 })
        .toArray(),
    ])

    const orderedTopics = sortCourseTopics(topics, branches)
    const topicOrder = new Map(orderedTopics.map((topic, index) => [String(topic._id), index]))
    const topicById = new Map(orderedTopics.map((topic) => [String(topic._id), topic]))
    const seen = new Set<string>()
    const pages = storedPages
      .filter((page) => {
        const key = `${String(page.topic_id)}:${Number(page.page_number)}`
        if (
          seen.has(key)
          || !topicById.has(String(page.topic_id))
          || !hasRenderableContent(page)
        ) return false
        seen.add(key)
        return true
      })
      .sort((a, b) => {
        const topicDelta = (topicOrder.get(String(a.topic_id)) ?? Number.MAX_SAFE_INTEGER)
          - (topicOrder.get(String(b.topic_id)) ?? Number.MAX_SAFE_INTEGER)
        return topicDelta || Number(a.page_number) - Number(b.page_number)
      })

    const generatedPageTotalByTopic = new Map<string, number>()
    for (const page of pages) {
      const topicId = String(page.topic_id)
      generatedPageTotalByTopic.set(
        topicId,
        Math.max(generatedPageTotalByTopic.get(topicId) ?? 0, Number(page.page_number)),
      )
    }

    const entries = pages.map((storedPage) => {
      const topicId = String(storedPage.topic_id)
      const topic = topicById.get(topicId)
      const globalPosition = computeGlobalPagePosition({
        topics: orderedTopics,
        branches,
        topicId,
        pageNumber: Number(storedPage.page_number),
      })

      return {
        page: serializePage(storedPage),
        topicTitle: String(topic?.title ?? 'Lesson'),
        topicPageTotal: Math.max(
          generatedPageTotalByTopic.get(topicId) ?? 1,
          Number(topic?.planned_pages ?? topic?.estimated_pages ?? topic?.total_pages_planned ?? 1),
        ),
        globalPageNumber: globalPosition.globalPageNumber,
      }
    })

    const globalPageTotal = entries.reduce(
      (total, entry) => Math.max(total, entry.globalPageNumber),
      0,
    )

    return NextResponse.json({
      courseTitle: String(course.title ?? course.topic ?? 'TruLurn course'),
      globalPageTotal: Math.max(
        globalPageTotal,
        entries[0]
          ? computeGlobalPagePosition({
              topics: orderedTopics,
              branches,
              topicId: entries[0].page.topic_id,
              pageNumber: entries[0].page.page_number,
            }).globalPageTotal
          : 0,
      ),
      entries,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown export error'
    const status = message.includes('sign in') ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
