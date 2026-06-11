import { transformToGraphData, type RawBranch, type RawTopic, type RawTopicEdge } from './transform'
import type { GraphData } from './types'

type CurriculumBranch = {
  id?: string
  title?: string
  description?: string
}

type SandboxCurriculum = {
  title?: string
  branches?: CurriculumBranch[]
}

type SandboxMapBranch = {
  id?: string
  title?: string
  state?: string
  active_topic_id?: string | null
  topic_count?: number
  mastered_count?: number
}

type SandboxMapTopic = {
  id?: string
  branch_id?: string
  section?: string
  title?: string
  position?: number
  sequence_index?: number
  parent_id?: string | null
  node_type?: string
  children_count?: number
  depth_level?: number
  prerequisite_strength?: Record<string, string>
  importance?: string
  role?: string
  spine_candidate?: boolean
  spine_level?: number
  state?: string
  prerequisites?: string[]
  recommended_next_ids?: string[]
  estimated_pages?: number
}

type SandboxMapEdge = {
  from_topic_id?: string
  to_topic_id?: string
  edge_type?: string
  reason?: string
}

export type SandboxMap = {
  branches?: SandboxMapBranch[]
  topics?: SandboxMapTopic[]
  structural_edges?: SandboxMapEdge[]
}

function edgeStrength(edgeType: string) {
  if (edgeType === 'prerequisite' || edgeType === 'sequence') return 3
  if (edgeType === 'recommended') return 2
  return 1
}

export function buildSandboxGraphData(
  curriculum: SandboxCurriculum,
  map: SandboxMap,
): GraphData {
  const courseId = 'graph-sandbox'
  const createdAt = new Date()
  const curriculumBranches = new Map(
    (curriculum.branches ?? []).map((branch) => [String(branch.id ?? ''), branch]),
  )

  const topics: RawTopic[] = (map.topics ?? [])
    .filter((topic) => topic.id && topic.branch_id && topic.title)
    .map((topic) => ({
      _id: String(topic.id),
      course_id: courseId,
      branch_id: String(topic.branch_id),
      section: String(topic.section ?? ''),
      title: String(topic.title),
      position: Number(topic.position ?? 0),
      sequence_index: Number(topic.sequence_index ?? topic.position ?? 0),
      parent_id: topic.parent_id ? String(topic.parent_id) : null,
      node_type: String(topic.node_type ?? 'learning_unit'),
      children_count: Number(topic.children_count ?? 0),
      depth_level: Number(topic.depth_level ?? 0),
      prerequisite_strength: topic.prerequisite_strength ?? {},
      importance_tag: topic.importance ?? null,
      role: topic.role ?? null,
      spine_candidate: Boolean(topic.spine_candidate),
      spine_level: Number(topic.spine_level ?? 0),
      state: String(topic.state ?? 'locked'),
      understanding_level: null,
      prerequisites: Array.isArray(topic.prerequisites)
        ? topic.prerequisites.map(String)
        : [],
      recommended_next_ids: Array.isArray(topic.recommended_next_ids)
        ? topic.recommended_next_ids.map(String)
        : [],
      estimated_pages: Number(topic.estimated_pages ?? 0),
      created_at: createdAt,
    }))

  const teachableCounts = new Map<string, number>()
  topics.forEach((topic) => {
    if (topic.node_type === 'container' || Number(topic.children_count ?? 0) > 0) return
    teachableCounts.set(topic.branch_id, (teachableCounts.get(topic.branch_id) ?? 0) + 1)
  })

  const branches: RawBranch[] = (map.branches ?? [])
    .filter((branch) => branch.id && branch.title)
    .map((branch) => {
      const branchId = String(branch.id)
      const curriculumBranch = curriculumBranches.get(branchId)
      return {
        _id: branchId,
        branch_key: branchId,
        course_id: courseId,
        title: String(branch.title),
        description: String(curriculumBranch?.description ?? branch.title),
        state: String(branch.state ?? 'not_started'),
        active_topic_id: branch.active_topic_id ? String(branch.active_topic_id) : null,
        topic_count: teachableCounts.get(branchId) ?? Number(branch.topic_count ?? 0),
        mastered_count: Number(branch.mastered_count ?? 0),
      }
    })

  const topicIds = new Set(topics.map((topic) => String(topic._id)))
  const topicEdges: RawTopicEdge[] = (map.structural_edges ?? [])
    .filter((edge) =>
      edge.from_topic_id
      && edge.to_topic_id
      && topicIds.has(String(edge.from_topic_id))
      && topicIds.has(String(edge.to_topic_id)),
    )
    .map((edge) => {
      const edgeType = String(edge.edge_type ?? 'semantic')
      return {
        from_topic_id: String(edge.from_topic_id),
        to_topic_id: String(edge.to_topic_id),
        edge_type: edgeType,
        reason: edge.reason ? String(edge.reason) : null,
        strength: edgeStrength(edgeType),
      }
    })

  const activeTopicId = topics.find((topic) => topic.state === 'active')?._id

  return transformToGraphData({
    courseId,
    courseTitle: String(curriculum.title ?? 'Graph sandbox course'),
    topics,
    branches,
    topicEdges,
    activeSingleTopicId: activeTopicId ? String(activeTopicId) : null,
  })
}
