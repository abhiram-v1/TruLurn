export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { LearnExperience } from '@/components/learn/LearnExperience'
import { MissingPageGenerator } from '@/components/learn/MissingPageGenerator'
import { BottomNav } from '@/components/navigation/BottomNav'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { computeGlobalPagePosition, sortCourseTopics } from '@/lib/course-pages/globalPageNumbers'
import { firstTeachableDescendant, isContainerTopic, nextRecommendedTeachableTopic, sortTracciaTopics } from '@/lib/traccia/sequence'

function isBlankGeneratedPage(page: any) {
  const content = String(page?.content ?? '').trim()
  const sectionContent = Array.isArray(page?.sections)
    ? page.sections.map((section: any) => String(section?.content ?? '').trim()).join('')
    : ''

  return content.length < 60 && sectionContent.length < 60
}

export default async function LearnTopicPage({
  params,
  searchParams,
}: {
  params: { courseId: string; topicId: string }
  searchParams?: { page?: string }
}) {
  const db = await getDb()
  const userId = await getRequiredUserId()

  // 1. Fetch Course
  const course = await db.collection('courses').findOne({ _id: params.courseId as any, user_id: userId })
  if (!course) {
    return <div style={{ padding: 40 }}>Course not found.</div>
  }

  // Decode the topicId — Next.js Link encodes colons (%3A) in path segments
  const topicId = decodeURIComponent(params.topicId)

  // 2. Fetch Topic
  const topic = await db.collection('topics').findOne({
    _id: topicId as any,
    course_id: params.courseId,
  })
  if (!topic) {
    return <div style={{ padding: 40 }}>Topic not found.</div>
  }

  const branchTopics = await db.collection('topics')
    .find({ course_id: params.courseId, branch_id: topic.branch_id })
    .sort({ sequence_index: 1, position: 1 })
    .toArray()

  if (isContainerTopic(topic)) {
    const descendant = firstTeachableDescendant(branchTopics as any, topicId)
    if (descendant) {
      redirect(`/learn/${params.courseId}/${encodeURIComponent(String(descendant._id))}`)
    }
  }

  if (topic.state === 'locked') {
    return (
      <main className="missing-page-shell">
        <section className="missing-page-panel">
          <p className="eyebrow">Locked topic</p>
          <h1 className="page-heading">{topic.title}</h1>
          <p className="page-subtitle">
            Complete the prerequisite topic first. TruLurn does not open locked Traccia nodes out of order.
          </p>
        </section>
        <BottomNav courseId={params.courseId} />
      </main>
    )
  }

  const courseTopics = await db.collection('topics')
    .find({ course_id: params.courseId })
    .project({
      title: 1,
      state: 1,
      branch_id: 1,
      branch_position: 1,
      position: 1,
      estimated_pages: 1,
      total_pages_planned: 1,
      node_type: 1,
      children_count: 1,
      sequence_index: 1,
      created_at: 1,
    })
    .sort({ branch_position: 1, branch_id: 1, sequence_index: 1, position: 1, created_at: 1 })
    .toArray()
  const courseBranches = await db.collection('branches')
    .find({ course_id: params.courseId })
    .project({ _id: 1, branch_key: 1, position: 1, created_at: 1 })
    .sort({ created_at: 1 })
    .toArray()
  const orderedCourseTopics = sortCourseTopics(courseTopics, courseBranches)

  // 4. Fetch Pages for this topic — deduplicate by page_number (keeps first stored copy
  //    per number to guard against any concurrent-generation duplicates in MongoDB).
  const allRawPages = await db.collection('pages')
    .find({ course_id: params.courseId, topic_id: topicId })
    .sort({ page_number: 1 })
    .toArray()

  const seenPageNumbers = new Set<number>()
  const pages = allRawPages.filter((p) => {
    if (seenPageNumbers.has(p.page_number)) return false
    seenPageNumbers.add(p.page_number)
    return true
  })

  // How many pages the AI planned for this topic (from curriculum generation)
  const estimatedPages = Math.max(1, Number(topic.estimated_pages ?? topic.total_pages_planned ?? 1))

  const requestedPage = Math.max(1, Number(searchParams?.page ?? '1'))

  // No pages at all → generate page 1
  if (!pages.length) {
    return (
      <MissingPageGenerator
        courseId={params.courseId}
        topicId={topicId}
        topicTitle={topic.title}
        pageNumber={1}
      />
    )
  }

  // Student navigated to a page not yet generated → generate it.
  // Always allow the immediately-next page beyond stored count, regardless of estimatedPages
  // (estimated_pages may be null/1 for existing topics — don't block discovery).
  // Hard cap at 15 pages per topic to prevent runaway generation.
  const maxAllowedPage = Math.min(Math.max(estimatedPages, pages.length + 1), 15)
  if (requestedPage > pages.length && requestedPage <= maxAllowedPage) {
    return (
      <MissingPageGenerator
        courseId={params.courseId}
        topicId={topicId}
        topicTitle={topic.title}
        pageNumber={requestedPage}
      />
    )
  }

  const safePage = Math.min(Math.max(requestedPage, 1), pages.length)
  const activePage = pages[safePage - 1]

  if (isBlankGeneratedPage(activePage)) {
    return (
      <MissingPageGenerator
        courseId={params.courseId}
        topicId={topicId}
        topicTitle={topic.title}
        pageNumber={activePage.page_number}
        force
      />
    )
  }

  // 6. Fetch recent course-level Doubt Messages. Each message still stores
  // topic/page context, but the chat should feel continuous across the course.
  const messages = await db.collection('doubtMessages')
    .find({ course_id: params.courseId, user_id: userId })
    .sort({ created_at: -1 })
    .limit(50)
    .toArray()

  const messageTopicIds = [...new Set(messages.map((m) => String(m.topic_id)))]
  const messageTopics = await db.collection('topics')
    .find({ course_id: params.courseId, _id: { $in: messageTopicIds as any[] } })
    .project({ title: 1 })
    .toArray()
  const messageTopicTitleById = new Map(
    messageTopics.map((messageTopic) => [String(messageTopic._id), messageTopic.title]),
  )

  // 7. Format data for LearnExperience component
  const serializedTopic = {
    id: String(topic._id),
    course_id: String(topic.course_id),
    title: topic.title,
    parent_id: topic.parent_id ? String(topic.parent_id) : null,
    position: topic.position,
    state: topic.state as any,
    understanding_level: topic.understanding_level,
    prerequisites: topic.prerequisites || [],
    created_at: topic.created_at.toISOString(),
    branch_id: String(topic.branch_id),
    section: topic.section,
    node_type: topic.node_type ?? undefined,
    depth_level: topic.depth_level ?? undefined,
    path_ids: Array.isArray(topic.path_ids) ? topic.path_ids.map(String) : undefined,
    path_titles: Array.isArray(topic.path_titles) ? topic.path_titles.map(String) : undefined,
    is_leaf: topic.is_leaf ?? undefined,
    children_count: topic.children_count ?? undefined,
    sequence_index: topic.sequence_index ?? undefined,
    recommended_next_ids: Array.isArray(topic.recommended_next_ids) ? topic.recommended_next_ids.map(String) : undefined,
    is_optional: topic.is_optional ?? undefined,
    covered_by_node_id: topic.covered_by_node_id ? String(topic.covered_by_node_id) : null,
  }

  const serializedTopics = branchTopics.map((t) => ({
    id: String(t._id),
    course_id: String(t.course_id),
    title: t.title,
    parent_id: t.parent_id ? String(t.parent_id) : null,
    position: t.position,
    state: t.state as any,
    understanding_level: t.understanding_level,
    prerequisites: t.prerequisites || [],
    created_at: t.created_at.toISOString(),
    branch_id: String(t.branch_id),
    section: t.section,
    node_type: t.node_type ?? undefined,
    depth_level: t.depth_level ?? undefined,
    path_ids: Array.isArray(t.path_ids) ? t.path_ids.map(String) : undefined,
    path_titles: Array.isArray(t.path_titles) ? t.path_titles.map(String) : undefined,
    is_leaf: t.is_leaf ?? undefined,
    children_count: t.children_count ?? undefined,
    sequence_index: t.sequence_index ?? undefined,
    recommended_next_ids: Array.isArray(t.recommended_next_ids) ? t.recommended_next_ids.map(String) : undefined,
    is_optional: t.is_optional ?? undefined,
    covered_by_node_id: t.covered_by_node_id ? String(t.covered_by_node_id) : null,
  }))

  const serializedPage = {
    id: String(activePage._id),
    topic_id: String(activePage.topic_id),
    page_number: activePage.page_number,
    content: activePage.content,
    created_at: activePage.created_at.toISOString(),
    topic_depth: activePage.topic_depth ?? undefined,
    concept_kind: activePage.concept_kind ?? undefined,
    content_kind: activePage.content_kind ?? undefined,
    should_generate_page: activePage.should_generate_page ?? undefined,
    decision_reason: activePage.decision_reason ?? undefined,
    estimated_length: activePage.estimated_length ?? undefined,
    requires_quiz: activePage.requires_quiz ?? undefined,
    covered_concepts: Array.isArray(activePage.covered_concepts) ? activePage.covered_concepts.map(String) : undefined,
    reused_concepts: Array.isArray(activePage.reused_concepts) ? activePage.reused_concepts.map(String) : undefined,
    reminder_concepts: Array.isArray(activePage.reminder_concepts) ? activePage.reminder_concepts.map(String) : undefined,
    example_refs: Array.isArray(activePage.example_refs) ? activePage.example_refs : undefined,
    sections: Array.isArray(activePage.sections) ? activePage.sections : undefined,
  }

  const serializedMessages = messages.reverse().map((m) => ({
    id: String(m._id),
    topic_id: String(m.topic_id),
    page_number: m.page_number,
    topic_title: messageTopicTitleById.get(String(m.topic_id)) ?? null,
    role: m.role as any,
    content: m.content,
    created_at: m.created_at.toISOString(),
  }))

  const orderedStudyTopics = sortTracciaTopics(orderedCourseTopics as any)
  const currentTopicIndex = orderedStudyTopics.findIndex((t: any) => String(t._id) === topicId)
  const globalPage = computeGlobalPagePosition({
    topics: orderedCourseTopics,
    branches: courseBranches,
    topicId,
    pageNumber: activePage.page_number,
  })
  const nextOpenTopic = currentTopicIndex >= 0
    ? nextRecommendedTeachableTopic(orderedStudyTopics as any, topicId)
    : null
  const serializedNextTopic = nextOpenTopic
    ? { id: String(nextOpenTopic._id), title: String(nextOpenTopic.title ?? 'Next topic') }
    : null

  return (
    <LearnExperience
      courseId={params.courseId}
      topic={serializedTopic}
      topics={serializedTopics}
      page={serializedPage}
      totalPages={pages.length}
      estimatedPages={estimatedPages}
      globalPageNumber={globalPage.globalPageNumber}
      globalPageTotal={globalPage.globalPageTotal}
      initialMessages={serializedMessages}
      nextTopic={serializedNextTopic}
    />
  )
}
