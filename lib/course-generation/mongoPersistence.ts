import crypto from 'crypto'
import { getDb } from '@/lib/db'
import type { CourseGenerationInput } from '@/lib/course-generation/input'

type PersistGeneratedCourseInput = CourseGenerationInput & {
  curriculum: any
  map: any
  userId: string
}

export type PersistedGeneratedCourse = {
  courseId: string
  firstTopicId: string
}

function makeStableNodeId(courseId: string, rawId: string) {
  return `${courseId}:${rawId}`
}

function buildCourseSummary(input: PersistGeneratedCourseInput, branchCount: number, topicCount: number) {
  return {
    title: input.curriculum?.title || input.topic,
    topic: input.topic,
    goals: input.goals,
    mode: input.mode,
    learning_control: input.learningControl,
    complexity: input.curriculum?.complexity ?? null,
    structure_reasoning: input.curriculum?.structure_reasoning ?? null,
    branch_count: branchCount,
    topic_count: topicCount,
    summary: input.curriculum?.structure_reasoning
      ?? `${input.topic} roadmap with ${branchCount} branches and ${topicCount} stored topics.`,
  }
}

function findCurriculumTopic(curriculum: any, topicId: string) {
  function visit(topic: any): any {
    if (topic?.id === topicId) return topic
    for (const child of topic?.children ?? []) {
      const found = visit(child)
      if (found) return found
    }
    return null
  }

  for (const branch of curriculum?.branches ?? []) {
    for (const section of branch.sections ?? []) {
      for (const topic of section.topics ?? []) {
        const found = visit(topic)
        if (found) return found
      }
    }
  }

  return null
}

function normalizeNodeType(topic: any) {
  const type = String(topic.node_type ?? '').trim()
  if (
    type === 'container' ||
    type === 'learning_unit' ||
    type === 'bridge' ||
    type === 'example_unit' ||
    type === 'assessment_unit'
  ) return type

  return topic.children_count > 0 || (Array.isArray(topic.children) && topic.children.length > 0)
    ? 'container'
    : 'learning_unit'
}

function isTeachableTopic(topic: any) {
  return normalizeNodeType(topic) !== 'container'
}

function buildRawTopicLookup(topics: any[]) {
  return new Map(topics.map((topic) => [String(topic.id), topic]))
}

function computeRawPath(topic: any, rawById: Map<string, any>) {
  const path: any[] = []
  const seen = new Set<string>()
  let cursor = topic

  while (cursor && !seen.has(String(cursor.id))) {
    seen.add(String(cursor.id))
    path.unshift(cursor)
    cursor = cursor.parent_id ? rawById.get(String(cursor.parent_id)) : null
  }

  return path.length ? path : [topic]
}

export async function persistGeneratedCourse(input: PersistGeneratedCourseInput): Promise<PersistedGeneratedCourse> {
  const db = await getDb()
  const courseId = crypto.randomUUID()
  const branches = Array.isArray(input.map?.branches) ? input.map.branches : []
  const topics = Array.isArray(input.map?.topics) ? input.map.topics : []
  const structuralEdges = Array.isArray(input.map?.structural_edges) ? input.map.structural_edges : []
  const firstBranch = branches[0]

  if (!firstBranch) throw new Error('Generated roadmap has no branches.')
  if (!topics.length) throw new Error('Generated roadmap has no topics.')

  const courseSummary = buildCourseSummary(input, branches.length, topics.length)

  await db.collection('courses').insertOne({
    _id: courseId as any,
    user_id: input.userId,
    title: input.curriculum?.title || input.topic,
    topic: input.topic,
    goals: input.goals || null,
    mode: input.mode,
    learning_control: input.learningControl,
    course_depth: input.courseDepth,
    progression_policy: {
      mode: input.learningControl,
      allow_agent_pruning: input.learningControl !== 'guided',
      allow_topic_jump: input.learningControl === 'open',
      require_quiz_to_unlock: input.learningControl === 'guided',
    },
    source_text: input.sourceText || null,
    source_limitations: input.sourceLimitations,
    summary: courseSummary.summary,
    complexity: courseSummary.complexity,
    structure_reasoning: courseSummary.structure_reasoning,
    branch_count: courseSummary.branch_count,
    topic_count: courseSummary.topic_count,
    status: 'ready',
    created_at: new Date(),
    updated_at: new Date(),
  })

  const idMap = new Map<string, string>()
  topics.forEach((topic: any) => {
    idMap.set(topic.id, makeStableNodeId(courseId, topic.id))
  })
  const rawById = buildRawTopicLookup(topics)
  const childCountByRawId = new Map<string, number>()
  for (const topic of topics) {
    if (!topic.parent_id) continue
    const parentId = String(topic.parent_id)
    childCountByRawId.set(parentId, (childCountByRawId.get(parentId) ?? 0) + 1)
  }

  // Build all topics as locked first, then activate exactly one below.
  const topicsToInsert = topics.map((topic: any, index: number) => {
    const topicId = idMap.get(topic.id) ?? makeStableNodeId(courseId, topic.id || crypto.randomUUID())
    const curriculumTopic = findCurriculumTopic(input.curriculum, topic.id)
    const description = curriculumTopic?.description ?? topic.description ?? null
    const rawPath = Array.isArray(topic.path_ids) && topic.path_ids.length
      ? topic.path_ids.map((id: string) => rawById.get(String(id))).filter(Boolean)
      : computeRawPath(topic, rawById)
    const pathIds = rawPath.map((pathTopic: any) => idMap.get(pathTopic.id) ?? makeStableNodeId(courseId, pathTopic.id))
    const pathTitles = Array.isArray(topic.path_titles) && topic.path_titles.length
      ? topic.path_titles
      : rawPath.map((pathTopic: any) => String(pathTopic.title ?? pathTopic.id))
    const childrenCount = Number.isFinite(topic.children_count)
      ? Number(topic.children_count)
      : childCountByRawId.get(String(topic.id)) ?? 0
    const nodeType = normalizeNodeType({ ...topic, children_count: childrenCount })
    const teachable = nodeType !== 'container'
    const estimatedPages = teachable
      ? Math.max(1, Number(topic.estimated_pages ?? topic.total_pages_planned ?? 1))
      : Math.max(0, Number(topic.estimated_pages ?? topic.total_pages_planned ?? 0))

    return {
      _id: topicId as any,
      course_id: courseId,
      branch_id: topic.branch_id,
      section: topic.section || 'Core',
      title: topic.title,
      description,
      summary: description,
      parent_id: topic.parent_id ? idMap.get(topic.parent_id) ?? null : null,
      path_ids: pathIds,
      path_titles: pathTitles,
      depth_level: Number.isFinite(topic.depth_level) ? Number(topic.depth_level) : Math.max(0, pathIds.length - 1),
      node_type: nodeType,
      is_leaf: topic.is_leaf !== undefined ? Boolean(topic.is_leaf) : childrenCount === 0,
      children_count: childrenCount,
      learning_depth: topic.learning_depth ?? (topic.depth === 'critical' ? 'deep' : topic.depth === 'light' ? 'overview' : 'standard'),
      position: Number.isFinite(topic.position) ? topic.position : index,
      sequence_index: Number.isFinite(topic.sequence_index) ? Number(topic.sequence_index) : index,
      recommended_next_ids: (topic.recommended_next_ids || []).map((id: string) => idMap.get(id) ?? id),
      is_optional: Boolean(topic.is_optional),
      covered_by_node_id: topic.covered_by_node_id ? idMap.get(topic.covered_by_node_id) ?? topic.covered_by_node_id : null,
      state: 'locked' as const,    // all start locked; exactly one is activated below
      understanding_level: null,
      prerequisites: (topic.prerequisites || []).map((id: string) => idMap.get(id) ?? id),
      depth: topic.depth ?? null,
      estimated_pages: estimatedPages,
      created_at: new Date(),
      updated_at: new Date(),
    }
  })

  // Exactly one topic starts active: the mapBuilder's designated active topic in the
  // first branch (position 0), falling back to the very first topic if none qualifies.
  const mapActiveId = firstBranch.active_topic_id
    ? idMap.get(firstBranch.active_topic_id) ?? null
    : null

  const firstActiveTopic =
    (mapActiveId ? topicsToInsert.find((t: any) => String(t._id) === mapActiveId) : null)
    ?? topicsToInsert.find((t: any) => t.branch_id === firstBranch.id && isTeachableTopic(t))
    ?? topicsToInsert.find((t: any) => isTeachableTopic(t))
    ?? topicsToInsert[0]

  // Mutate the chosen leaf and its ancestor containers to active.
  ;(firstActiveTopic as any).state = 'active'
  for (const ancestorId of firstActiveTopic.path_ids ?? []) {
    const ancestor = topicsToInsert.find((topic: any) => String(topic._id) === String(ancestorId))
    if (ancestor) ancestor.state = 'active'
  }

  const firstActiveTopicId = String(firstActiveTopic._id)

  const branchesToInsert = branches.map((branch: any, index: number) => {
    const branchTopics = topicsToInsert.filter((topic: any) => topic.branch_id === branch.id)
    const isFirst = index === 0
    const teachableBranchTopics = branchTopics.filter(isTeachableTopic)
    const activeTopic = isFirst ? firstActiveTopic : teachableBranchTopics[0] ?? branchTopics[0]

    return {
      _id: makeStableNodeId(courseId, branch.id) as any,
      branch_key: branch.id,
      course_id: courseId,
      title: branch.title,
      description: input.curriculum?.branches?.find((item: any) => item.id === branch.id)?.description || branch.description || branch.title,
      state: isFirst ? 'in_progress' : 'not_started',
      active_topic_id: activeTopic ? String(activeTopic._id) : null,
      topic_count: teachableBranchTopics.length || branchTopics.length,
      mastered_count: 0,
      created_at: new Date(),
      updated_at: new Date(),
    }
  })

  const edgeKeys = new Set<string>()
  const edgesToInsert = structuralEdges.map((edge: any) => {
    const from = idMap.get(edge.from_topic_id) ?? edge.from_topic_id
    const to = idMap.get(edge.to_topic_id) ?? edge.to_topic_id
    edgeKeys.add(`${from}::${to}::${edge.edge_type ?? 'semantic'}`)
    return {
    _id: crypto.randomUUID() as any,
    course_id: courseId,
    from_topic_id: from,
    to_topic_id: to,
    edge_type: edge.edge_type ?? 'semantic',
    reason: edge.reason ?? null,
    strength: 1,
    created_at: new Date(),
  }})

  for (const topic of topicsToInsert) {
    if (topic.parent_id) {
      const key = `${topic.parent_id}::${topic._id}::hierarchy`
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key)
        edgesToInsert.push({
          _id: crypto.randomUUID() as any,
          course_id: courseId,
          from_topic_id: String(topic.parent_id),
          to_topic_id: String(topic._id),
          edge_type: 'hierarchy',
          reason: `${topic.title} belongs under ${topic.path_titles?.at(-2) ?? 'its parent'}.`,
          strength: 1,
          created_at: new Date(),
        })
      }
    }

    for (const prereqId of topic.prerequisites ?? []) {
      const key = `${prereqId}::${topic._id}::prerequisite`
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key)
        edgesToInsert.push({
          _id: crypto.randomUUID() as any,
          course_id: courseId,
          from_topic_id: String(prereqId),
          to_topic_id: String(topic._id),
          edge_type: 'prerequisite',
          reason: `${prereqId} is a prerequisite for ${topic.title}.`,
          strength: 2,
          created_at: new Date(),
        })
      }
    }
  }

  await db.collection('branches').insertMany(branchesToInsert)
  await db.collection('topics').insertMany(topicsToInsert)
  if (edgesToInsert.length) {
    await db.collection('topicEdges').insertMany(edgesToInsert)
  }
  await db.collection('courseSummaries').insertOne({
    _id: crypto.randomUUID() as any,
    course_id: courseId,
    user_id: input.userId,
    ...courseSummary,
    created_at: new Date(),
  })
  await db.collection('topicSummaries').insertMany(
    topicsToInsert.map((topic: any) => ({
      _id: crypto.randomUUID() as any,
      course_id: courseId,
      topic_id: String(topic._id),
      title: topic.title,
      summary: topic.summary ?? `${topic.title} is part of the ${topic.section} section.`,
      key_concepts: [],
      created_at: new Date(),
    }))
  )

  return {
    courseId,
    firstTopicId: firstActiveTopicId,
  }
}
