import { isTeachableTopic, sortTracciaTopics } from '@/lib/traccia/sequence'
import type { LessonHardStampedInsight } from '@/types'

export type ContinuityTopic = {
  _id: unknown
  title?: string
  summary?: string | null
  description?: string | null
  key_concepts?: string[]
  prerequisites?: string[]
  prerequisite_strength?: Record<string, 'hard' | 'soft' | string>
  sequence_index?: number
  position?: number
  path_ids?: string[]
  node_type?: string
  children_count?: number
}

export type CourseRetrievalScope = {
  currentTopicId: string
  priorTopicIds: string[]
  directPrerequisiteIds: string[]
  transitivePrerequisiteIds: string[]
  requiredTopicIds: string[]
  previousTopicId: string | null
  invalidPrerequisiteIds: string[]
}

export type ConceptConnectionRequirement = {
  source_topic_id: string
  source_topic_title: string
  target_topic_id: string
  target_topic_title: string
  relation: 'hard_prerequisite' | 'soft_prerequisite' | 'sequence'
  teaching_status: 'taught' | 'not_yet_taught' | 'invalid_order'
  evidence_summary: string | null
  evidence_concepts: string[]
  evidence_hard_stamps: LessonHardStampedInsight[]
  required_in_explanation: boolean
}

export type CourseContinuityContext = {
  current_topic: { id: string; title: string }
  retrieval_scope: CourseRetrievalScope
  connections: ConceptConnectionRequirement[]
  canonical_terms: string[]
  unmet_prerequisites: string[]
}

function idOf(topic: ContinuityTopic) {
  return String(topic._id)
}

function normalizeIds(values: unknown) {
  return Array.isArray(values)
    ? [...new Set(values.map(String).filter(Boolean))]
    : []
}

/**
 * Builds the only topic set that lesson retrieval may use. This is deliberately
 * graph/sequence based rather than semantic: a future page can be highly similar
 * to the current topic and must still never be presented as prior knowledge.
 */
export function buildCourseRetrievalScope({
  topics,
  currentTopicId,
  prerequisiteDepth = 3,
}: {
  topics: ContinuityTopic[]
  currentTopicId: string
  prerequisiteDepth?: number
}): CourseRetrievalScope {
  const ordered = sortTracciaTopics(topics).filter((topic) => isTeachableTopic(topic))
  const byId = new Map(topics.map((topic) => [idOf(topic), topic]))
  const currentIndex = ordered.findIndex((topic) => idOf(topic) === currentTopicId)
  const prior = currentIndex >= 0 ? ordered.slice(0, currentIndex) : []
  const priorIds = prior.map(idOf)
  const priorSet = new Set(priorIds)
  const current = byId.get(currentTopicId)
  const direct = normalizeIds(current?.prerequisites)
  const invalid = direct.filter((id) => !byId.has(id) || !priorSet.has(id))

  const transitive: string[] = []
  const seen = new Set(direct)
  let frontier = direct.filter((id) => priorSet.has(id))
  for (let depth = 0; depth < Math.max(0, prerequisiteDepth - 1) && frontier.length; depth += 1) {
    const next: string[] = []
    for (const prerequisiteId of frontier) {
      const prerequisite = byId.get(prerequisiteId)
      for (const ancestorId of normalizeIds(prerequisite?.prerequisites)) {
        if (seen.has(ancestorId) || !priorSet.has(ancestorId)) continue
        seen.add(ancestorId)
        transitive.push(ancestorId)
        next.push(ancestorId)
      }
    }
    frontier = next
  }

  const previousTopicId = currentIndex > 0 ? idOf(ordered[currentIndex - 1]) : null
  const requiredTopicIds = [...new Set([
    ...direct.filter((id) => priorSet.has(id)),
    ...transitive,
    ...(previousTopicId ? [previousTopicId] : []),
  ])]

  return {
    currentTopicId,
    priorTopicIds: priorIds,
    directPrerequisiteIds: direct,
    transitivePrerequisiteIds: transitive,
    requiredTopicIds,
    previousTopicId,
    invalidPrerequisiteIds: invalid,
  }
}

function clean(value: unknown, max = 420) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

function uniqueTerms(values: unknown[], max = 24) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const term = clean(value, 100)
    const key = term.toLowerCase()
    if (!term || seen.has(key)) continue
    seen.add(key)
    result.push(term)
    if (result.length >= max) break
  }
  return result
}

export function buildCourseContinuityContext({
  topics,
  currentTopicId,
  taughtTopicIds,
  summariesByTopic = new Map(),
}: {
  topics: ContinuityTopic[]
  currentTopicId: string
  taughtTopicIds: Iterable<string>
  summariesByTopic?: Map<string, { summary?: string | null; key_concepts?: string[]; hard_stamped_insights?: LessonHardStampedInsight[] }>
}): CourseContinuityContext {
  const scope = buildCourseRetrievalScope({ topics, currentTopicId })
  const byId = new Map(topics.map((topic) => [idOf(topic), topic]))
  const taught = new Set([...taughtTopicIds].map(String))
  const current = byId.get(currentTopicId)
  const currentTitle = clean(current?.title) || 'Current topic'
  const connections: ConceptConnectionRequirement[] = []

  for (const prerequisiteId of scope.directPrerequisiteIds) {
    const prerequisite = byId.get(prerequisiteId)
    const summary = summariesByTopic.get(prerequisiteId)
    const isPrior = scope.priorTopicIds.includes(prerequisiteId)
    const strength = current?.prerequisite_strength?.[prerequisiteId] === 'soft' ? 'soft_prerequisite' : 'hard_prerequisite'
    connections.push({
      source_topic_id: prerequisiteId,
      source_topic_title: clean(prerequisite?.title) || prerequisiteId,
      target_topic_id: currentTopicId,
      target_topic_title: currentTitle,
      relation: strength,
      teaching_status: !isPrior ? 'invalid_order' : taught.has(prerequisiteId) ? 'taught' : 'not_yet_taught',
      evidence_summary: clean(summary?.summary ?? prerequisite?.summary ?? prerequisite?.description) || null,
      evidence_concepts: uniqueTerms([
        ...(summary?.key_concepts ?? []),
        ...(prerequisite?.key_concepts ?? []),
      ], 8),
      evidence_hard_stamps: Array.isArray(summary?.hard_stamped_insights) ? summary.hard_stamped_insights : [],
      required_in_explanation: strength === 'hard_prerequisite' && isPrior && taught.has(prerequisiteId),
    })
  }

  if (scope.previousTopicId && !connections.some((item) => item.source_topic_id === scope.previousTopicId)) {
    const previous = byId.get(scope.previousTopicId)
    const summary = summariesByTopic.get(scope.previousTopicId)
    connections.push({
      source_topic_id: scope.previousTopicId,
      source_topic_title: clean(previous?.title) || scope.previousTopicId,
      target_topic_id: currentTopicId,
      target_topic_title: currentTitle,
      relation: 'sequence',
      teaching_status: taught.has(scope.previousTopicId) ? 'taught' : 'not_yet_taught',
      evidence_summary: clean(summary?.summary ?? previous?.summary ?? previous?.description) || null,
      evidence_concepts: uniqueTerms([
        ...(summary?.key_concepts ?? []),
        ...(previous?.key_concepts ?? []),
      ], 8),
      evidence_hard_stamps: Array.isArray(summary?.hard_stamped_insights) ? summary.hard_stamped_insights : [],
      required_in_explanation: false,
    })
  }

  const relevantTopics = [
    current,
    ...connections.map((connection) => byId.get(connection.source_topic_id)),
  ].filter(Boolean) as ContinuityTopic[]

  return {
    current_topic: { id: currentTopicId, title: currentTitle },
    retrieval_scope: scope,
    connections,
    canonical_terms: uniqueTerms(relevantTopics.flatMap((topic) => [
      topic.title,
      ...(topic.key_concepts ?? []),
    ])),
    unmet_prerequisites: connections
      .filter((connection) => connection.relation === 'hard_prerequisite' && connection.teaching_status !== 'taught')
      .map((connection) => connection.source_topic_title),
  }
}

export function formatCourseContinuityContext(context: CourseContinuityContext) {
  const lines = [
    'STRUCTURED COURSE STATE (authoritative for continuity):',
    `Current concept: ${context.current_topic.title}`,
    `Eligible prior topics: ${context.retrieval_scope.priorTopicIds.length}`,
    `Canonical terminology: ${context.canonical_terms.join('; ') || 'none stored'}`,
  ]

  const required = context.connections.filter((connection) => connection.required_in_explanation)
  if (required.length) {
    lines.push('REQUIRED CONCEPT BRIDGES:')
    for (const connection of required) {
      lines.push(
        `- ${connection.source_topic_title} -> ${connection.target_topic_title}: previously taught${connection.evidence_summary ? ` as “${connection.evidence_summary}”` : ''}. Explicitly state (1) the earlier concept's role, (2) the current concept's distinct role, and (3) how information, control, or reasoning passes between them. Never imply they are the same process.`,
      )
      for (const stamp of connection.evidence_hard_stamps) {
        lines.push(`  Durable mental model already established: ${stamp.statement} Mapping: ${stamp.mapping}${stamp.boundary ? ` Boundary: ${stamp.boundary}` : ''}`)
      }
    }
  }

  const sequence = context.connections.filter((connection) =>
    connection.relation === 'sequence' && connection.teaching_status === 'taught'
  )
  if (sequence.length) {
    lines.push(`Recent taught context: ${sequence.map((item) => item.source_topic_title).join('; ')}. Use only when it creates a real conceptual bridge.`)
  }

  if (context.unmet_prerequisites.length) {
    lines.push(`PREREQUISITE GAPS: ${context.unmet_prerequisites.join('; ')}. Do not claim the learner already knows these. Supply the minimum accurate repair before using them.`)
  }

  lines.push(
    'Continuity acceptance rule: callbacks must appear in the lesson prose, not only in metadata. A valid bridge names both concepts, distinguishes their jobs, and explains their dependency or handoff.',
  )
  return lines.join('\n')
}
