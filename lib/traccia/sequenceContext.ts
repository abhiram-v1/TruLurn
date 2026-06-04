import type { Db } from 'mongodb'
import type { CourseMemoryContext } from '@/lib/vector/retrieval'
import { nextRecommendedTeachableTopic, sortTracciaTopics } from '@/lib/traccia/sequence'

export type SequenceCoverageState =
  | 'new'
  | 'already_explained'
  | 'needs_hint'
  | 'needs_recontextualization'
  | 'avoid_repeating'

export type SequenceExampleRef = {
  label: string
  topic_title?: string | null
  page_number?: number | null
  excerpt: string
}

export type SequenceContextPack = {
  text: string
  coveredConcepts: string[]
  reusedConcepts: string[]
  reminderConcepts: string[]
  exampleRefs: SequenceExampleRef[]
}

type TopicLike = {
  _id: unknown
  title?: string
  branch_id?: string
  section?: string
  parent_id?: string | null
  path_ids?: string[]
  path_titles?: string[]
  sequence_index?: number
  position?: number
  state?: string
  recommended_next_ids?: string[]
  prerequisites?: string[]
  key_concepts?: string[]
  summary?: string | null
  description?: string | null
}

function compact(value: unknown, max = 320) {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}...` : clean
}

function normalizeConcept(value: unknown) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, (char) => char.toUpperCase())
}

function conceptCandidates(topic: TopicLike, prerequisites: any[]) {
  const raw = [
    topic.title,
    ...(topic.key_concepts ?? []),
    ...(topic.path_titles ?? []),
    ...prerequisites.flatMap((item) => [item.title, ...(item.key_concepts ?? [])]),
  ]

  const seen = new Set<string>()
  return raw
    .map(normalizeConcept)
    .filter((item) => item.length >= 3)
    .filter((item) => {
      if (seen.has(item)) return false
      seen.add(item)
      return true
    })
    .slice(0, 14)
}

function includesConcept(haystack: unknown, concept: string) {
  const text = normalizeConcept(haystack)
  return Boolean(concept) && Boolean(text) && (text === concept || text.includes(concept) || concept.includes(text))
}

function extractExampleRefs(pages: any[], limit = 3): SequenceExampleRef[] {
  const refs: SequenceExampleRef[] = []

  for (const page of pages) {
    const content = String(page.content ?? '')
    if (!content.trim()) continue

    const exampleMatch =
      content.match(/(?:\*\*)?Example(?::|\s+-)\s*([^*\n]+)?[\s\S]{0,520}/i)
      ?? content.match(/(?:for example|consider|imagine)\s+[\s\S]{0,420}/i)

    if (!exampleMatch) continue

    refs.push({
      label: compact(exampleMatch[1] || page.focus || page.summary || 'Earlier example', 80),
      topic_title: page.topic_title ?? null,
      page_number: typeof page.page_number === 'number' ? page.page_number : null,
      excerpt: compact(exampleMatch[0], 420),
    })

    if (refs.length >= limit) break
  }

  return refs
}

export async function buildSequenceContextPack({
  db,
  courseId,
  userId,
  topic,
  pageNumber,
  previousPages = [],
  memory,
}: {
  db: Db
  courseId: string
  userId: string
  topic: TopicLike
  pageNumber: number
  previousPages?: any[]
  memory?: CourseMemoryContext
}): Promise<SequenceContextPack> {
  const topicId = String(topic._id)
  const prerequisiteIds = (topic.prerequisites ?? []).map(String)

  const [branchTopics, prerequisiteTopics, priorSummaries, recentEvents] = await Promise.all([
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
        content_state: 1,
        recommended_next_ids: 1,
      })
      .toArray(),
    prerequisiteIds.length
      ? db.collection('topics')
          .find({ course_id: courseId, _id: { $in: prerequisiteIds as any[] } })
          .project({ title: 1, summary: 1, description: 1, key_concepts: 1 })
          .toArray()
      : Promise.resolve([]),
    db.collection('pageSummaries')
      .find({ course_id: courseId, user_id: userId, topic_id: { $ne: topicId } })
      .project({
        topic_id: 1,
        page_number: 1,
        focus: 1,
        summary: 1,
        key_concepts: 1,
        covered_concepts: 1,
        reused_concepts: 1,
        reminder_concepts: 1,
        example_refs: 1,
        created_at: 1,
      })
      .sort({ created_at: -1 })
      .limit(30)
      .toArray(),
    db.collection('learningEvents')
      .find({
        course_id: courseId,
        user_id: userId,
        event_type: {
          $in: [
            'sequence_context_applied',
            'content_shape_skip',
            'agent_skip_requested',
          ],
        },
      })
      .sort({ created_at: -1 })
      .limit(8)
      .toArray(),
  ])

  const candidates = conceptCandidates(topic, prerequisiteTopics)
  const priorPages = [
    ...previousPages.map((page) => ({ ...page, topic_title: topic.title })),
    ...(memory?.pages ?? []),
  ]
  const exampleRefs = extractExampleRefs(priorPages)
  const cueMap = new Map<string, { state: SequenceCoverageState; source?: string }>()

  for (const concept of candidates) {
    const previousHit = previousPages.find((page) =>
      includesConcept(page.summary, concept)
      || includesConcept(page.focus, concept)
      || (page.key_concepts ?? []).some((item: string) => includesConcept(item, concept)),
    )
    const prerequisiteHit = prerequisiteTopics.find((item) =>
      includesConcept(item.title, concept)
      || includesConcept(item.summary ?? item.description, concept)
      || (item.key_concepts ?? []).some((key: string) => includesConcept(key, concept)),
    )
    const summaryHit = priorSummaries.find((summary) =>
      includesConcept(summary.focus, concept)
      || includesConcept(summary.summary, concept)
      || [...(summary.key_concepts ?? []), ...(summary.covered_concepts ?? [])]
        .some((item: string) => includesConcept(item, concept)),
    )
    const memoryHit = memory?.pages.find((page) =>
      includesConcept(page.focus, concept)
      || includesConcept(page.summary, concept)
      || includesConcept(page.content, concept),
    )

    if (previousHit) {
      cueMap.set(concept, { state: 'avoid_repeating', source: `earlier page ${previousHit.page_number}` })
    } else if (prerequisiteHit) {
      cueMap.set(concept, { state: 'needs_hint', source: String(prerequisiteHit.title ?? 'prerequisite') })
    } else if (summaryHit || memoryHit) {
      const source = summaryHit
        ? `course page ${summaryHit.page_number ?? '?'}`
        : `${memoryHit?.topic_title ?? 'related course page'} p${memoryHit?.page_number ?? '?'}`
      cueMap.set(concept, { state: 'already_explained', source })
    } else {
      cueMap.set(concept, { state: 'new' })
    }
  }

  const currentPath = (topic.path_titles?.length ? topic.path_titles : [topic.section, topic.title])
    .filter(Boolean)
    .join(' > ')
  const sortedBranchTopics = sortTracciaTopics(branchTopics as any)
  const next = nextRecommendedTeachableTopic(sortedBranchTopics as any, topicId)
  const siblings = sortedBranchTopics
    .filter((candidate: any) => String(candidate.parent_id ?? '') === String(topic.parent_id ?? ''))
    .filter((candidate: any) => String(candidate._id) !== topicId)
    .slice(0, 6)
    .map((item: any) => item.title)
  const cues = [...cueMap.entries()]

  const lines = [
    'SEQUENCE CONTEXT PACK:',
    `Current path: ${currentPath || topic.title || 'Current topic'}`,
    next ? `Recommended next teachable node: ${next.title}` : 'Recommended next teachable node: none',
    siblings.length ? `Nearby sibling nodes: ${siblings.join(', ')}` : null,
  ].filter(Boolean) as string[]

  const byState = (state: SequenceCoverageState) => cues.filter(([, cue]) => cue.state === state)
  const formatCue = ([concept, cue]: [string, { state: SequenceCoverageState; source?: string }]) =>
    `${titleCase(concept)}${cue.source ? ` (${cue.source})` : ''}`

  const already = byState('already_explained')
  const hints = byState('needs_hint')
  const avoid = byState('avoid_repeating')
  const fresh = byState('new')

  if (already.length) lines.push(`Already explained: ${already.slice(0, 5).map(formatCue).join('; ')}.`)
  if (hints.length) lines.push(`Use short reminder hints for: ${hints.slice(0, 5).map(formatCue).join('; ')}.`)
  if (avoid.length) lines.push(`Avoid re-teaching: ${avoid.slice(0, 4).map(formatCue).join('; ')}.`)
  if (fresh.length) lines.push(`Likely new concepts: ${fresh.slice(0, 5).map(formatCue).join('; ')}.`)

  if (exampleRefs.length) {
    lines.push(`Reusable examples: ${exampleRefs.map((ref) =>
      `${ref.label}${ref.topic_title ? ` from ${ref.topic_title}` : ''}${ref.page_number ? ` p${ref.page_number}` : ''}`
    ).join('; ')}.`)
  }

  if (recentEvents.length) {
    lines.push(`Recent sequence events: ${recentEvents.map((event) =>
      `${event.event_type}${event.topic_id ? ` on ${event.topic_id}` : ''}`
    ).join('; ')}.`)
  }

  lines.push(
    'Continuity instructions: if a concept is already explained, give 2-4 reminder bullets or a one-paragraph bridge only. Reuse listed examples unless they would mislead in this context. Explain only the contextual difference when the same idea appears under a new node.',
  )

  return {
    text: lines.join('\n'),
    coveredConcepts: cues.map(([concept]) => titleCase(concept)).slice(0, 12),
    reusedConcepts: already.map(([concept]) => titleCase(concept)).slice(0, 8),
    reminderConcepts: [...hints, ...avoid].map(([concept]) => titleCase(concept)).slice(0, 8),
    exampleRefs,
  }
}
