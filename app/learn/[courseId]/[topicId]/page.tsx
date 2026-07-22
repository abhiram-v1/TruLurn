export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { LearnExperience } from '@/components/learn/LearnExperience'
import { MissingPageGenerator } from '@/components/learn/MissingPageGenerator'
import { BottomNav } from '@/components/navigation/BottomNav'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import {
  getCachedCourse,
  getCachedCourseTopics,
  getCachedCourseBranches,
  invalidateCourse,
  getCachedTopicPages,
} from '@/lib/cache/courseData'
import { computeGlobalPagePosition, sortCourseTopics } from '@/lib/course-pages/globalPageNumbers'
import { firstTeachableDescendant, isContainerTopic, nextRecommendedTeachableTopic, sortTracciaTopics } from '@/lib/traccia/sequence'
import { computeQuizNudge } from '@/lib/quiz/courseQuizNudge'

function isBlankGeneratedPage(page: any) {
  const content = String(page?.content ?? '').trim()
  const sectionContent = Array.isArray(page?.sections)
    ? page.sections.map((section: any) => String(section?.content ?? '').trim()).join('')
    : ''

  return content.length < 60 && sectionContent.length < 60
}

function cleanConceptLabel(value: unknown) {
  const label = String(value ?? '')
    .replace(/[`*_~#[\]()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!label) return ''
  if (/^(introduction|overview|core concepts|explanation|what comes next|summary)$/i.test(label)) return ''
  return label.length > 72 ? `${label.slice(0, 69).trim()}...` : label
}

function addConcept(labels: string[], seen: Set<string>, value: unknown) {
  const label = cleanConceptLabel(value)
  if (!label) return
  const key = label.toLowerCase()
  if (seen.has(key)) return
  seen.add(key)
  labels.push(label)
}

function headingConcepts(markdown: unknown) {
  const text = String(markdown ?? '')
  const matches = Array.from(text.matchAll(/^#{2,3}\s+(.+)$/gm))
  return matches.map((match) => match[1])
}

function collectPageConcepts(storedPage: any) {
  const labels: string[] = []
  const seen = new Set<string>()

  for (const concept of Array.isArray(storedPage.key_concepts) ? storedPage.key_concepts : []) {
    addConcept(labels, seen, concept)
  }
  for (const concept of Array.isArray(storedPage.covered_concepts) ? storedPage.covered_concepts : []) {
    addConcept(labels, seen, concept)
  }
  const authorityConcepts = storedPage.generation_authority?.sequence?.concepts
  for (const concept of Array.isArray(authorityConcepts) ? authorityConcepts : []) {
    addConcept(labels, seen, concept)
  }
  for (const section of Array.isArray(storedPage.sections) ? storedPage.sections : []) {
    for (const heading of headingConcepts(section?.content)) addConcept(labels, seen, heading)
  }
  for (const heading of headingConcepts(storedPage.content)) addConcept(labels, seen, heading)

  if (!labels.length) addConcept(labels, seen, `Page ${storedPage.page_number}`)
  return labels.slice(0, 6)
}

export default async function LearnTopicPage({
  params,
  searchParams,
}: {
  params: { courseId: string; topicId: string }
  searchParams?: { page?: string }
}) {
  const [db, userId] = await Promise.all([getDb(), getRequiredUserId()])

  const topicId = decodeURIComponent(params.topicId)
  // Course structure (course doc, all topics, branches) is read-mostly within a
  // study session — served from the in-memory cache to avoid re-hitting Mongo on
  // every navigation. Per-topic pages and chat history stay live (below).
  const [course, allTopics, courseBranches] = await Promise.all([
    getCachedCourse(db, params.courseId, userId),
    getCachedCourseTopics(db, params.courseId),
    getCachedCourseBranches(db, params.courseId),
  ])
  if (!course) {
    return <div style={{ padding: 40 }}>Course not found.</div>
  }

  // Decode the topicId — Next.js Link encodes colons (%3A) in path segments
  const topic = allTopics.find((t) => String(t._id) === topicId)
  if (!topic) {
    return <div style={{ padding: 40 }}>Topic not found.</div>
  }

  if (isContainerTopic(topic)) {
    const branchTopics = allTopics
      .filter((t) => String(t.branch_id) === String(topic.branch_id))
      .sort((a, b) => (Number(a.sequence_index ?? 0) - Number(b.sequence_index ?? 0)) || (Number(a.position ?? 0) - Number(b.position ?? 0)))
    const descendant = firstTeachableDescendant(branchTopics as any, topicId)
    if (descendant) {
      // If the container is active but its first leaf is still locked, the map builder
      // designated a container as the active node instead of a leaf. Auto-repair: activate
      // the leaf so the student can actually open the lesson.
      if (String(descendant.state) === 'locked' && String(topic.state) === 'active') {
        await db.collection('topics').updateOne(
          { _id: String(descendant._id) as any, course_id: params.courseId },
          { $set: { state: 'active', updated_at: new Date() } },
        )
        // Drop the cached state so the redirected reload sees the activation
        // (otherwise the cached 'locked' state would persist until TTL).
        invalidateCourse(params.courseId)
      }
      redirect(`/learn/${params.courseId}/${encodeURIComponent(String(descendant._id))}`)
    }
  }

  // Page-count authority: once the topic's lesson plan exists, planned_pages is
  // the real page count (the plan consolidates thin topics). The curriculum's
  // estimated_pages is only the pre-plan guess.
  const plannedPages = Number(topic.planned_pages) > 0 ? Number(topic.planned_pages) : null
  const estimatedPages = Math.max(1, plannedPages ?? Number(topic.estimated_pages ?? topic.total_pages_planned ?? 1))

  if (topic.state === 'locked') {
    // Topics are open for free navigation — the quiz system tracks mastery but never
    // gates lesson access. Auto-activate and reload so the lesson renders normally.
    await db.collection('topics').updateOne(
      { _id: topicId as any, course_id: params.courseId },
      { $set: { state: 'active', updated_at: new Date() } },
    )
    // Invalidate before redirect so the reload doesn't re-read a cached 'locked'
    // state and bounce in a redirect loop.
    invalidateCourse(params.courseId)
    redirect(`/learn/${params.courseId}/${encodeURIComponent(topicId)}`)
  }

  // Only per-topic pages are live reads now; course structure
  // is served from cache above. branchTopics/courseTopics derive from it.
  // Doubt messages (and which saved chat thread is open) are loaded
  // asynchronously client-side.
  const allRawPages = await getCachedTopicPages(db, params.courseId, topicId)
  const branchTopics = allTopics
    .filter((t) => String(t.branch_id) === String(topic.branch_id))
    .sort((a, b) => (Number(a.sequence_index ?? 0) - Number(b.sequence_index ?? 0)) || (Number(a.position ?? 0) - Number(b.position ?? 0)))
  const courseTopics = allTopics
  const orderedCourseTopics = sortCourseTopics(courseTopics, courseBranches)

  // 4. Fetch Pages for this topic — deduplicate by page_number (keeps first stored copy
  //    per number to guard against any concurrent-generation duplicates in MongoDB).
  const seenPageNumbers = new Set<number>()
  const pages = allRawPages.filter((p) => {
    if (seenPageNumbers.has(p.page_number)) return false
    seenPageNumbers.add(p.page_number)
    return true
  })

  const requestedPage = Math.max(1, Number(searchParams?.page ?? '1'))

  // No pages at all → generate page 1 (the topic plan is created in the same
  // request; later pages prefetch one-ahead while the student reads).
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
  // With a lesson plan: generation is capped at the planned page count — thin
  // topics cannot balloon by clicking Next (custom pages via the agent are
  // already stored, so viewing them is unaffected). Without a plan yet
  // (first touch / legacy topics): allow the next page so the generate route
  // can build the plan and decide. Hard cap at 15 pages either way.
  const maxAllowedPage = plannedPages !== null
    ? Math.min(Math.max(plannedPages, pages.length), 15)
    : Math.min(Math.max(estimatedPages, pages.length + 1), 15)
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

  const serializePage = (storedPage: any) => ({
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
    figures: Array.isArray(storedPage.figures) ? storedPage.figures : undefined,
    grounding: storedPage.grounding ?? null,
    learning_architecture: storedPage.learning_architecture ?? null,
    target_understanding: storedPage.target_understanding
      ?? storedPage.learning_architecture?.target_understanding
      ?? null,
    success_criteria: Array.isArray(storedPage.success_criteria)
      ? storedPage.success_criteria.map(String)
      : Array.isArray(storedPage.learning_architecture?.success_criteria)
        ? storedPage.learning_architecture.success_criteria.map(String)
        : [],
    active_processing: storedPage.active_processing
      ?? storedPage.learning_architecture?.active_processing
      ?? null,
    retention_hooks: storedPage.retention_hooks
      ?? storedPage.learning_architecture?.retention_hooks
      ?? null,
    page_sequence_role: storedPage.page_sequence_role
      ?? storedPage.learning_architecture?.page_sequence_role
      ?? null,
  })
  const serializedPage = serializePage(activePage)
  const serializedConceptPages = pages.map((storedPage) => ({
    id: String(storedPage._id),
    page_number: Number(storedPage.page_number),
    concepts: collectPageConcepts(storedPage),
    summary: storedPage.summary ? String(storedPage.summary) : null,
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
    ? nextRecommendedTeachableTopic(orderedStudyTopics as any, topicId, { allowLocked: true })
    : null
  const serializedNextTopic = nextOpenTopic
    ? { id: String(nextOpenTopic._id), title: String(nextOpenTopic.title ?? 'Next topic') }
    : null

  const reviewGaps: string[] = Array.isArray(topic.review_gaps)
    ? topic.review_gaps.map(String).filter(Boolean)
    : []

  // Balanced-mode-only nudge toward a quiz once completed topics pile up
  // without one. Guided courses gate on quizzes elsewhere; open courses are
  // left alone, so skip the extra query for both.
  const learningControl = String(course.learning_control ?? 'balanced')
  const quizNudge = learningControl === 'balanced'
    ? await computeQuizNudge(db, userId, params.courseId, allTopics as any)
    : null

  return (
    <LearnExperience
      courseId={params.courseId}
      courseTitle={String(course.title ?? '')}
      topic={serializedTopic}
      topics={serializedTopics}
      page={serializedPage}
      conceptPages={serializedConceptPages}
      totalPages={pages.length}
      estimatedPages={estimatedPages}
      globalPageNumber={globalPage.globalPageNumber}
      globalPageTotal={globalPage.globalPageTotal}
      nextTopic={serializedNextTopic}
      reviewGaps={reviewGaps}
      learningControl={learningControl}
      quizNudge={quizNudge}
    />
  )
}
