import type { Db } from 'mongodb'

type TopicLike = {
  _id: unknown
  title?: string
  branch_id?: string
  section?: string
  state?: string
  parent_id?: string | null
  path_ids?: string[]
  path_titles?: string[]
  node_type?: string
  is_leaf?: boolean
  children_count?: number
  position?: number
  sequence_index?: number
  recommended_next_ids?: string[]
  prerequisites?: string[]
  estimated_pages?: number | null
  summary?: string | null
  description?: string | null
  content_state?: string | null
}

function idOf(topic: TopicLike) {
  return String(topic._id)
}

export function isContainerTopic(topic: TopicLike) {
  return String(topic.node_type ?? '') === 'container' || Number(topic.children_count ?? 0) > 0
}

export function isTeachableTopic(topic: TopicLike) {
  return !isContainerTopic(topic)
}

export function sortTracciaTopics<T extends TopicLike>(topics: T[]) {
  return [...topics].sort((a, b) => {
    const aSeq = Number.isFinite(Number(a.sequence_index)) ? Number(a.sequence_index) : Number.MAX_SAFE_INTEGER
    const bSeq = Number.isFinite(Number(b.sequence_index)) ? Number(b.sequence_index) : Number.MAX_SAFE_INTEGER
    if (aSeq !== bSeq) return aSeq - bSeq

    const aDepth = Number(a.path_ids?.length ?? 0)
    const bDepth = Number(b.path_ids?.length ?? 0)
    if (aDepth !== bDepth) return aDepth - bDepth

    return Number(a.position ?? 0) - Number(b.position ?? 0)
  })
}

export function firstTeachableTopic<T extends TopicLike>(topics: T[]) {
  return sortTracciaTopics(topics).find(isTeachableTopic) ?? null
}

export function firstTeachableDescendant<T extends TopicLike>(topics: T[], topicId: string) {
  const descendants = topics.filter((topic) => (topic.path_ids ?? []).map(String).includes(topicId) && idOf(topic) !== topicId)
  return firstTeachableTopic(descendants)
}

export function nextTeachableTopic<T extends TopicLike>(topics: T[], currentTopicId: string) {
  const ordered = sortTracciaTopics(topics).filter(isTeachableTopic)
  const currentIndex = ordered.findIndex((topic) => idOf(topic) === currentTopicId)
  return currentIndex >= 0 ? ordered[currentIndex + 1] ?? null : firstTeachableTopic(ordered)
}

function isAvailableStudyTopic(topic: TopicLike, allowLocked = false) {
  const state = String(topic.state ?? 'active')
  const contentState = String(topic.content_state ?? '')
  if (!isTeachableTopic(topic)) return false
  if (!allowLocked && state === 'locked') return false
  if (contentState === 'skipped' || contentState === 'pruned_by_student') return false
  return true
}

export function nextRecommendedTeachableTopic<T extends TopicLike>(
  topics: T[],
  currentTopicId: string,
  options: { allowLocked?: boolean } = {},
) {
  const ordered = sortTracciaTopics(topics)
  const current = ordered.find((topic) => idOf(topic) === currentTopicId)
  const allowLocked = Boolean(options.allowLocked)

  if (current?.recommended_next_ids?.length) {
    for (const nextId of current.recommended_next_ids) {
      const candidate = ordered.find((topic) => idOf(topic) === String(nextId))
      if (candidate && isAvailableStudyTopic(candidate, allowLocked)) return candidate
    }
  }

  const currentIndex = ordered.findIndex((topic) => idOf(topic) === currentTopicId)
  const afterCurrent = currentIndex >= 0 ? ordered.slice(currentIndex + 1) : ordered
  // Only look forward — never wrap back to the start of the course.
  // If nothing is available after the current topic, return null so the UI
  // shows "Back to Atlas" instead of incorrectly looping to the first topic.
  return afterCurrent.find((topic) => isAvailableStudyTopic(topic, allowLocked)) ?? null
}

export function previousTeachableTopic<T extends TopicLike>(topics: T[], currentTopicId: string) {
  const ordered = sortTracciaTopics(topics).filter(isTeachableTopic)
  const currentIndex = ordered.findIndex((topic) => idOf(topic) === currentTopicId)
  return currentIndex > 0 ? ordered[currentIndex - 1] ?? null : null
}

function compact(value: unknown, max = 360) {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}...` : clean
}

export async function buildGenerationPointer({
  db,
  courseId,
  topic,
  pageNumber,
}: {
  db: Db
  courseId: string
  topic: TopicLike
  pageNumber: number
}) {
  const [branch, branchTopics, previousPage, prerequisiteTopics] = await Promise.all([
    db.collection('branches').findOne({
      course_id: courseId,
      $or: [
        { branch_key: topic.branch_id },
        { _id: topic.branch_id as any },
      ],
    }),
    db.collection('topics')
      .find({ course_id: courseId, branch_id: topic.branch_id })
      .project({
        title: 1,
        parent_id: 1,
        path_ids: 1,
        path_titles: 1,
        node_type: 1,
        children_count: 1,
        sequence_index: 1,
        position: 1,
        state: 1,
        summary: 1,
        description: 1,
      })
      .toArray(),
    pageNumber > 1
      ? db.collection('pages').findOne({
          course_id: courseId,
          topic_id: String(topic._id),
          page_number: pageNumber - 1,
        })
      : Promise.resolve(null),
    topic.prerequisites?.length
      ? db.collection('topics')
          .find({ course_id: courseId, _id: { $in: topic.prerequisites as any[] } })
          .project({ title: 1, summary: 1, description: 1 })
          .toArray()
      : Promise.resolve([]),
  ])

  const topicId = idOf(topic)
  const parent = topic.parent_id
    ? branchTopics.find((candidate) => idOf(candidate as TopicLike) === String(topic.parent_id)) ?? null
    : null
  const siblings = branchTopics
    .filter((candidate) => String(candidate.parent_id ?? '') === String(topic.parent_id ?? ''))
    .filter((candidate) => idOf(candidate as TopicLike) !== topicId)
    .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
    .slice(0, 8)
  const children = branchTopics
    .filter((candidate) => String(candidate.parent_id ?? '') === topicId)
    .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
    .slice(0, 8)
  const next = nextTeachableTopic(branchTopics as TopicLike[], topicId)

  const lines = [
    'COURSE MAP POINTER:',
    `Atlas branch: ${branch?.title ?? topic.branch_id ?? 'Current branch'}`,
    `Visible Traccia parent: ${parent?.title ?? topic.section ?? 'Current section'}`,
    `Internal Traccia path: ${(topic.path_titles?.length ? topic.path_titles : [topic.title]).join(' > ')}`,
    `Current teachable node: ${topic.title}`,
    `Current node type: ${topic.node_type ?? 'learning_unit'}`,
    `Page request: ${pageNumber}`,
    next ? `Next recommended node: ${next.title}` : 'Next recommended node: none',
  ]

  if (siblings.length) {
    lines.push(`Nearby sibling nodes: ${siblings.map((item) => item.title).join(', ')}`)
  }

  if (children.length) {
    lines.push(`Immediate child nodes: ${children.map((item) => item.title).join(', ')}`)
  }

  if (prerequisiteTopics.length) {
    lines.push(`Prerequisites: ${prerequisiteTopics.map((item) => `${item.title}${item.summary || item.description ? ` (${compact(item.summary ?? item.description, 120)})` : ''}`).join('; ')}`)
  }

  if (previousPage) {
    lines.push(`Previous generated page: ${previousPage.focus ?? 'Previous page'} - ${compact(previousPage.summary ?? previousPage.content, 220)}`)
  }

  return {
    text: lines.join('\n'),
    nextTopic: next ? { id: idOf(next), title: String(next.title ?? 'Next topic') } : null,
    parentTitle: parent?.title ?? null,
  }
}
