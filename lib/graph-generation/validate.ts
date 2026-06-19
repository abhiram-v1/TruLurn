import { flattenCurriculumForGraph } from './curriculum.ts'
import type {
  GeneratedGraphMap,
  GraphGenerationInput,
  GraphGenerationIssue,
  GraphGenerationValidationReport,
} from './types.ts'

const EDGE_TYPES = new Set(['hierarchy', 'prerequisite', 'recommended', 'semantic'])
const NODE_TYPES = new Set(['container', 'learning_unit', 'bridge', 'example_unit', 'assessment_unit'])
const MAX_HARD_FAN_IN = 6

function issue(
  issues: GraphGenerationIssue[],
  code: string,
  message: string,
  path?: string,
) {
  issues.push({ code, message, ...(path ? { path } : {}) })
}

function findCycle(successors: Map<string, string[]>) {
  const state = new Map<string, 0 | 1 | 2>()
  const stack: string[] = []

  const visit = (node: string): string[] | null => {
    state.set(node, 1)
    stack.push(node)
    for (const next of successors.get(node) ?? []) {
      if (state.get(next) === 1) {
        const start = stack.indexOf(next)
        return [...stack.slice(start), next]
      }
      if (!state.get(next)) {
        const cycle = visit(next)
        if (cycle) return cycle
      }
    }
    stack.pop()
    state.set(node, 2)
    return null
  }

  for (const node of successors.keys()) {
    if (!state.get(node)) {
      const cycle = visit(node)
      if (cycle) return cycle
    }
  }
  return null
}

export function validateGeneratedCourseGraph(
  input: GraphGenerationInput,
  map: GeneratedGraphMap,
): GraphGenerationValidationReport {
  const curriculum = flattenCurriculumForGraph(input.curriculum)
  const issues: GraphGenerationIssue[] = []
  const branches = Array.isArray(map?.branches) ? map.branches : []
  const topics = Array.isArray(map?.topics) ? map.topics : []
  const edges = Array.isArray(map?.structural_edges) ? map.structural_edges : []
  const curriculumIds = new Set(curriculum.topics.map((topic) => topic.id))
  const curriculumById = new Map(curriculum.topics.map((topic) => [topic.id, topic]))
  const curriculumBranchIds = new Set(curriculum.branches.map((branch) => branch.id))
  const knownSourceRefs = new Set(
    (input.sourceEvidencePackets ?? []).map((packet) => packet.source_id),
  )
  const graphIds = new Set<string>()
  const graphById = new Map<string, any>()
  const graphBranchIds = new Set<string>()
  const referenced = new Set<string>()
  let sourceBackedNodes = 0
  let maxHardFanIn = 0

  for (const [index, branch] of branches.entries()) {
    const id = String(branch?.id ?? '').trim()
    if (!id) {
      issue(issues, 'missing_branch_id', 'Every graph branch requires an id.', `branches[${index}]`)
      continue
    }
    if (graphBranchIds.has(id)) {
      issue(issues, 'duplicate_branch_id', `Branch id "${id}" appears more than once.`, `branches[${index}].id`)
    }
    graphBranchIds.add(id)
    if (!curriculumBranchIds.has(id)) {
      issue(issues, 'invented_branch', `Graph branch "${id}" is absent from the approved curriculum.`, `branches[${index}].id`)
    }
  }
  for (const id of curriculumBranchIds) {
    if (!graphBranchIds.has(id)) issue(issues, 'missing_branch', `Approved branch "${id}" is missing from the graph.`)
  }
  for (const [index, branch] of branches.entries()) {
    const activeTopicId = branch?.active_topic_id == null ? null : String(branch.active_topic_id)
    if (activeTopicId && !curriculumIds.has(activeTopicId)) {
      issue(
        issues,
        'invalid_branch_active_topic',
        `Branch "${String(branch?.id ?? index)}" references unknown active topic "${activeTopicId}".`,
        `branches[${index}].active_topic_id`,
      )
    }
  }

  let activeTeachable = 0
  for (const [index, topic] of topics.entries()) {
    const path = `topics[${index}]`
    const id = String(topic?.id ?? '').trim()
    if (!id) {
      issue(issues, 'missing_topic_id', 'Every graph topic requires an id.', path)
      continue
    }
    if (graphIds.has(id)) issue(issues, 'duplicate_topic_id', `Topic id "${id}" appears more than once.`, `${path}.id`)
    graphIds.add(id)
    graphById.set(id, topic)
    const canonical = curriculumById.get(id)
    if (!canonical) {
      issue(issues, 'invented_topic', `Graph topic "${id}" is absent from the approved curriculum.`, `${path}.id`)
      continue
    }
    if (String(topic.title ?? '').trim() !== canonical.title) {
      issue(issues, 'title_mismatch', `Topic "${id}" must preserve title "${canonical.title}".`, `${path}.title`)
    }
    if (String(topic.branch_id ?? '') !== canonical.branch_id) {
      issue(issues, 'branch_mismatch', `Topic "${id}" must remain in branch "${canonical.branch_id}".`, `${path}.branch_id`)
    }
    if (!NODE_TYPES.has(String(topic.node_type ?? ''))) {
      issue(issues, 'invalid_node_type', `Topic "${id}" has an invalid node_type.`, `${path}.node_type`)
    }
    const parentId = topic.parent_id == null ? null : String(topic.parent_id)
    if (parentId && !curriculumIds.has(parentId)) {
      issue(issues, 'invalid_parent_reference', `Topic "${id}" has unknown parent "${parentId}".`, `${path}.parent_id`)
    } else if (parentId && curriculumById.get(parentId)?.branch_id !== canonical.branch_id) {
      issue(issues, 'cross_branch_parent', `Topic "${id}" cannot move under a parent in another branch.`, `${path}.parent_id`)
    }
    const pathIds: string[] = Array.isArray(topic.path_ids) ? topic.path_ids.map(String) : []
    if (pathIds.at(-1) !== id || (parentId && pathIds.at(-2) !== parentId)) {
      issue(issues, 'path_mismatch', `Topic "${id}" has path_ids inconsistent with its parent hierarchy.`, `${path}.path_ids`)
    }
    if (new Set(pathIds).size !== pathIds.length) {
      issue(issues, 'hierarchy_cycle', `Topic "${id}" repeats an id in its hierarchy path.`, `${path}.path_ids`)
    }
    const recommendedNextIds: string[] = Array.isArray(topic.recommended_next_ids)
      ? topic.recommended_next_ids.map(String)
      : []
    for (const nextId of recommendedNextIds) {
      if (!curriculumIds.has(nextId)) {
        issue(
          issues,
          'invalid_recommended_reference',
          `Topic "${id}" recommends unknown topic "${nextId}".`,
          `${path}.recommended_next_ids`,
        )
      }
      if (nextId === id) {
        issue(issues, 'self_recommendation', `Topic "${id}" cannot recommend itself.`, `${path}.recommended_next_ids`)
      }
    }
    const coveredByNodeId = topic.covered_by_node_id == null ? null : String(topic.covered_by_node_id)
    if (coveredByNodeId && !curriculumIds.has(coveredByNodeId)) {
      issue(
        issues,
        'invalid_coverage_reference',
        `Topic "${id}" is covered by unknown topic "${coveredByNodeId}".`,
        `${path}.covered_by_node_id`,
      )
    }

    const prerequisites: string[] = Array.isArray(topic.prerequisites) ? topic.prerequisites.map(String) : []
    const hardFanIn = prerequisites.filter((prerequisite) =>
      String(topic?.prerequisite_strength?.[prerequisite] ?? 'hard') !== 'soft').length
    maxHardFanIn = Math.max(maxHardFanIn, hardFanIn)
    if (hardFanIn > MAX_HARD_FAN_IN) {
      issue(
        issues,
        'excessive_hard_fan_in',
        `Topic "${id}" has ${hardFanIn} hard prerequisites; the maximum is ${MAX_HARD_FAN_IN}.`,
        `${path}.prerequisites`,
      )
    }
    for (const prerequisite of prerequisites) {
      referenced.add(id)
      referenced.add(prerequisite)
      if (!curriculumIds.has(prerequisite)) {
        issue(
          issues,
          'invalid_prerequisite_reference',
          `Topic "${id}" references unknown prerequisite "${prerequisite}".`,
          `${path}.prerequisites`,
        )
      }
      if (prerequisite === id) {
        issue(issues, 'self_prerequisite', `Topic "${id}" cannot depend on itself.`, `${path}.prerequisites`)
      }
    }

    const sourceRefs: string[] = Array.isArray(topic.source_refs) ? topic.source_refs.map(String).filter(Boolean) : []
    if (sourceRefs.length) sourceBackedNodes += 1
    if (input.mode === 'source_grounded' && !sourceRefs.length) {
      issue(issues, 'missing_node_source_refs', `Source-grounded topic "${id}" needs source_refs.`, `${path}.source_refs`)
    }
    for (const sourceRef of sourceRefs) {
      if (!knownSourceRefs.has(sourceRef)) {
        issue(issues, 'invalid_node_source_ref', `Topic "${id}" references unknown evidence packet "${sourceRef}".`, `${path}.source_refs`)
      }
    }
    if (
      String(topic.state) === 'active'
      && String(topic.node_type) !== 'container'
      && Number(topic.children_count ?? 0) === 0
    ) activeTeachable += 1
  }

  for (const id of curriculumIds) {
    if (!graphIds.has(id)) issue(issues, 'missing_topic', `Approved curriculum topic "${id}" is missing from the graph.`)
  }
  if (activeTeachable !== 1) {
    issue(issues, 'invalid_active_topic_count', `Expected exactly one active teachable topic; received ${activeTeachable}.`)
  }

  const hierarchySuccessors = new Map<string, string[]>()
  for (const id of graphIds) hierarchySuccessors.set(id, [])
  for (const [id, topic] of graphById) {
    const parentId = topic.parent_id == null ? null : String(topic.parent_id)
    if (parentId && hierarchySuccessors.has(parentId)) hierarchySuccessors.get(parentId)!.push(id)

    const expectedPath: string[] = []
    const seen = new Set<string>()
    let cursor: string | null = id
    while (cursor && graphById.has(cursor) && !seen.has(cursor)) {
      seen.add(cursor)
      expectedPath.unshift(cursor)
      const parent: unknown = graphById.get(cursor)?.parent_id
      cursor = parent == null ? null : String(parent)
    }
    const actualPath: string[] = Array.isArray(topic.path_ids) ? topic.path_ids.map(String) : []
    if (
      expectedPath.length !== actualPath.length
      || expectedPath.some((value, index) => value !== actualPath[index])
    ) {
      issue(issues, 'path_mismatch', `Topic "${id}" path_ids do not match its parent chain.`, `topics.${id}.path_ids`)
    }
  }
  const hierarchyCycle = findCycle(hierarchySuccessors)
  if (hierarchyCycle) {
    issue(issues, 'hierarchy_cycle', `Parent hierarchy contains a cycle: ${hierarchyCycle.join(' -> ')}.`)
  }

  const edgeKeys = new Set<string>()
  const directPrerequisiteEdges = new Map<string, { sourceRefs: string[] }>()
  for (const [index, edge] of edges.entries()) {
    const path = `structural_edges[${index}]`
    const from = String(edge?.from_topic_id ?? '')
    const to = String(edge?.to_topic_id ?? '')
    const edgeType = String(edge?.edge_type ?? '')
    if (!graphIds.has(from) || !graphIds.has(to)) {
      issue(issues, 'invalid_edge_reference', `Edge "${from}" -> "${to}" references a missing topic.`, path)
    }
    if (from === to) issue(issues, 'self_edge', `Topic "${from}" cannot connect to itself.`, path)
    if (!EDGE_TYPES.has(edgeType)) issue(issues, 'invalid_edge_type', `Edge type "${edgeType}" is invalid.`, `${path}.edge_type`)
    const key = `${from}::${to}::${edgeType}`
    if (edgeKeys.has(key)) issue(issues, 'duplicate_edge', `Duplicate edge "${key}".`, path)
    edgeKeys.add(key)
    if (edgeType === 'prerequisite') {
      directPrerequisiteEdges.set(`${from}::${to}`, {
        sourceRefs: Array.isArray(edge?.source_refs) ? edge.source_refs.map(String).filter(Boolean) : [],
      })
    }
    referenced.add(from)
    referenced.add(to)

    if (input.mode === 'source_grounded') {
      const sourceRefs: string[] = Array.isArray(edge?.source_refs) ? edge.source_refs.map(String).filter(Boolean) : []
      const reason = String(edge?.reason ?? '')
      const curriculumJustification = edgeType === 'hierarchy'
        || (edgeType === 'recommended' && /curriculum|source order|study order/i.test(reason))
      if (!sourceRefs.length && !curriculumJustification) {
        issue(
          issues,
          'unsupported_source_edge',
          `Source-grounded ${edgeType} edge "${from}" -> "${to}" needs evidence or curriculum justification.`,
          path,
        )
      }
      for (const sourceRef of sourceRefs) {
        if (!knownSourceRefs.has(sourceRef)) {
          issue(issues, 'invalid_edge_source_ref', `Edge "${from}" -> "${to}" references unknown packet "${sourceRef}".`, `${path}.source_refs`)
        }
      }
    }
  }

  const successors = new Map<string, string[]>()
  for (const id of graphIds) successors.set(id, [])
  for (const topic of topics) {
    const to = String(topic?.id ?? '')
    const prerequisites: string[] = Array.isArray(topic?.prerequisites)
      ? topic.prerequisites.map(String)
      : []
    for (const prerequisite of prerequisites) {
      if (String(topic?.prerequisite_strength?.[prerequisite] ?? 'hard') === 'soft') continue
      if (successors.has(prerequisite) && successors.has(to)) successors.get(prerequisite)!.push(to)
    }
  }
  for (const edge of edges) {
    if (String(edge?.edge_type ?? '') !== 'prerequisite') continue
    const from = String(edge?.from_topic_id ?? '')
    const to = String(edge?.to_topic_id ?? '')
    if (successors.has(from) && successors.has(to)) successors.get(from)!.push(to)
  }
  const cycle = findCycle(successors)
  if (cycle) issue(issues, 'hard_prerequisite_cycle', `Hard prerequisites contain a cycle: ${cycle.join(' -> ')}.`)

  if (
    input.mode === 'source_grounded'
    && curriculum.source_sequence_policy === 'preserve_uploaded_source_order'
  ) {
    for (const branch of curriculum.branches) {
      const ordered = curriculum.topics.filter((topic) => topic.branch_id === branch.id)
      const sequenceValues = new Set<number>()
      for (const topic of ordered) {
        const sequence = Number(graphById.get(topic.id)?.sequence_index)
        if (!Number.isFinite(sequence)) {
          issue(issues, 'missing_sequence_index', `Topic "${topic.id}" needs a finite sequence_index.`)
        } else if (sequenceValues.has(sequence)) {
          issue(issues, 'duplicate_sequence_index', `Branch "${branch.id}" reuses sequence_index ${sequence}.`)
        }
        sequenceValues.add(sequence)
      }
      for (let index = 0; index < ordered.length - 1; index += 1) {
        const earlier = ordered[index]
        const later = ordered[index + 1]
        const earlierSequence = Number(graphById.get(earlier.id)?.sequence_index)
        const laterSequence = Number(graphById.get(later.id)?.sequence_index)
        if (earlierSequence <= laterSequence) continue
        const justification = directPrerequisiteEdges.get(`${later.id}::${earlier.id}`)
        if (!justification?.sourceRefs.length) {
          issue(
            issues,
            'unsupported_source_reordering',
            `Source order moves "${later.id}" before "${earlier.id}" without an evidence-backed prerequisite.`,
          )
        }
      }
    }
  }

  const orphanIds = curriculum.topics
    .filter((topic) => topic.node_type !== 'container')
    .map((topic) => topic.id)
    .filter((id) => !referenced.has(id))
  if (topics.length > 1) {
    orphanIds.forEach((id) => issue(issues, 'orphan_topic', `Topic "${id}" has no graph relationship.`))
  }

  return {
    valid: issues.length === 0,
    issues,
    metrics: {
      curriculum_nodes: curriculumIds.size,
      graph_nodes: graphIds.size,
      branches: graphBranchIds.size,
      edges: edges.length,
      source_backed_nodes: sourceBackedNodes,
      orphan_nodes: orphanIds.length,
      max_hard_fan_in: maxHardFanIn,
    },
  }
}
