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
    complexity: input.curriculum?.complexity ?? null,
    structure_reasoning: input.curriculum?.structure_reasoning ?? null,
    branch_count: branchCount,
    topic_count: topicCount,
    summary: input.curriculum?.structure_reasoning
      ?? `${input.topic} roadmap with ${branchCount} branches and ${topicCount} stored topics.`,
  }
}

function findCurriculumTopic(curriculum: any, topicId: string) {
  for (const branch of curriculum?.branches ?? []) {
    for (const section of branch.sections ?? []) {
      const topic = (section.topics ?? []).find((item: any) => item.id === topicId)
      if (topic) return topic
    }
  }

  return null
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
    source_text: input.sourceText || null,
    source_limitations: input.sourceLimitations,
    summary: courseSummary.summary,
    complexity: courseSummary.complexity,
    structure_reasoning: courseSummary.structure_reasoning,
    status: 'ready',
    created_at: new Date(),
    updated_at: new Date(),
  })

  const idMap = new Map<string, string>()
  topics.forEach((topic: any) => {
    idMap.set(topic.id, makeStableNodeId(courseId, topic.id))
  })

  const topicsToInsert = topics.map((topic: any, index: number) => {
    const topicId = idMap.get(topic.id) ?? makeStableNodeId(courseId, topic.id || crypto.randomUUID())
    const isFirstTopicOfFirstBranch = topic.branch_id === firstBranch.id && (topic.position === 0 || topic.position === 1 || index === 0)
    const curriculumTopic = findCurriculumTopic(input.curriculum, topic.id)
    const description = curriculumTopic?.description ?? topic.description ?? null

    return {
      _id: topicId as any,
      course_id: courseId,
      branch_id: topic.branch_id,
      section: topic.section || 'Core',
      title: topic.title,
      description,
      summary: description,
      parent_id: topic.parent_id ? idMap.get(topic.parent_id) ?? null : null,
      position: Number.isFinite(topic.position) ? topic.position : index,
      state: isFirstTopicOfFirstBranch ? 'active' : 'locked',
      understanding_level: null,
      prerequisites: (topic.prerequisites || []).map((id: string) => idMap.get(id) ?? id),
      depth: topic.depth ?? null,
      estimated_pages: topic.estimated_pages ?? topic.total_pages_planned ?? null,
      created_at: new Date(),
      updated_at: new Date(),
    }
  })

  const firstActiveTopic = topicsToInsert.find((topic: any) => topic.state === 'active') ?? topicsToInsert[0]
  const firstActiveTopicId = String(firstActiveTopic._id)

  const branchesToInsert = branches.map((branch: any, index: number) => {
    const branchTopics = topicsToInsert.filter((topic: any) => topic.branch_id === branch.id)
    const isFirst = index === 0
    const activeTopic = isFirst ? firstActiveTopic : branchTopics[0]

    return {
      _id: makeStableNodeId(courseId, branch.id) as any,
      branch_key: branch.id,
      course_id: courseId,
      title: branch.title,
      description: input.curriculum?.branches?.find((item: any) => item.id === branch.id)?.description || branch.description || branch.title,
      state: isFirst ? 'in_progress' : 'not_started',
      active_topic_id: activeTopic ? String(activeTopic._id) : null,
      topic_count: branchTopics.length,
      mastered_count: 0,
      created_at: new Date(),
      updated_at: new Date(),
    }
  })

  const edgesToInsert = structuralEdges.map((edge: any) => ({
    _id: crypto.randomUUID() as any,
    course_id: courseId,
    from_topic_id: idMap.get(edge.from_topic_id) ?? edge.from_topic_id,
    to_topic_id: idMap.get(edge.to_topic_id) ?? edge.to_topic_id,
    reason: edge.reason ?? null,
    strength: 1,
    created_at: new Date(),
  }))

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
