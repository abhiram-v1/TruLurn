import { createHash } from 'crypto'
import type { AIResponseSchema } from '@/lib/ai/types'
import { flattenCurriculumForGraph } from './curriculum.ts'
import { buildGraphSourceEvidencePackets } from './evidence.ts'
import { buildGraphEdgeStagePrompt, buildGraphNodeStagePrompt } from './prompt.ts'
import {
  GRAPH_GENERATION_MODEL,
  GRAPH_GENERATION_SCHEMA_VERSION,
  GraphGenerationError,
  type GeneratedGraphMap,
  type GraphGenerationInput,
  type GraphGenerationIssue,
  type GraphGenerationProvenance,
  type GraphGenerationResult,
  type GraphGenerationValidationReport,
} from './types.ts'
import { validateGeneratedCourseGraph } from './validate.ts'

// Per-stage retries for transient problems (timeout, unreadable JSON, a branch
// returning the wrong node set). Whole-pipeline rounds re-run the affected
// stage(s) when the assembled graph fails deterministic validation.
const MAX_STAGE_ATTEMPTS = 3
const MAX_ROUNDS = 2

// Each step now carries only one branch's nodes (or just the edges), so a fast
// model finishes well inside this ceiling; it stays configurable as a backstop.
const GRAPH_GENERATION_TIMEOUT_MS = Number(process.env.AI_GRAPH_GENERATION_TIMEOUT_MS ?? 180_000)

const EMPTY_GRAPH_METRICS: GraphGenerationValidationReport['metrics'] = {
  curriculum_nodes: 0,
  graph_nodes: 0,
  branches: 0,
  edges: 0,
  source_backed_nodes: 0,
  orphan_nodes: 0,
  max_hard_fan_in: 0,
}

const EDGE_ISSUE_CODES = new Set([
  'invalid_edge_reference',
  'self_edge',
  'invalid_edge_type',
  'duplicate_edge',
  'unsupported_source_edge',
  'invalid_edge_source_ref',
])

// Issues that can originate from either a node's prerequisites or a structural
// edge, so both stages get the correction.
const SHARED_ISSUE_CODES = new Set([
  'hard_prerequisite_cycle',
  'orphan_topic',
  'unsupported_source_reordering',
])

export type GraphGenerationRequest = {
  feature: 'graph_generation'
  system: string
  user: string
  responseMimeType: 'application/json'
  responseSchema: AIResponseSchema
  signal?: AbortSignal
  timeoutMs?: number
}

export type GraphGenerationExecutor = (
  request: GraphGenerationRequest,
) => Promise<{ text: string; provider: string; model?: string }>

function fingerprint(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function extractJsonObject(text: string): any {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/)
  const source = fenced?.[1]?.trim() ?? trimmed
  const first = source.indexOf('{')
  const last = source.lastIndexOf('}')
  if (first < 0 || last <= first) {
    throw new Error('Gemini response did not contain a valid JSON object.')
  }
  return JSON.parse(source.slice(first, last + 1))
}

function validateBranchNodes(
  branchId: string,
  approved: Array<{ id: string }>,
  emitted: any[] | null,
): GraphGenerationIssue[] {
  const issues: GraphGenerationIssue[] = []
  if (!Array.isArray(emitted)) {
    return [{ code: 'invalid_graph_response', message: `Branch "${branchId}" did not return a topics array.` }]
  }
  const approvedIds = new Set(approved.map((topic) => topic.id))
  const seen = new Set<string>()
  for (const topic of emitted) {
    const id = String(topic?.id ?? '').trim()
    if (!id) {
      issues.push({ code: 'missing_topic_id', message: `Branch "${branchId}" emitted a topic without an id.` })
      continue
    }
    if (!approvedIds.has(id)) {
      issues.push({ code: 'invented_topic', message: `Topic "${id}" is not an approved node in branch "${branchId}".` })
    }
    if (seen.has(id)) {
      issues.push({ code: 'duplicate_topic_id', message: `Topic "${id}" appears more than once in branch "${branchId}".` })
    }
    seen.add(id)
  }
  for (const id of approvedIds) {
    if (!seen.has(id)) {
      issues.push({ code: 'missing_topic', message: `Approved topic "${id}" is missing from branch "${branchId}".` })
    }
  }
  return issues
}

// Decide which stage(s) should be re-run for each validation issue, and for node
// issues which branch they belong to (so only the affected branches re-run).
function classifyIssues(
  issues: GraphGenerationIssue[],
  orderedTopics: any[],
  branchIds: string[],
) {
  const nodeByBranch = new Map<string, GraphGenerationIssue[]>()
  const edgeIssues: GraphGenerationIssue[] = []

  const addNode = (branchId: string, issue: GraphGenerationIssue) => {
    const list = nodeByBranch.get(branchId) ?? []
    list.push(issue)
    nodeByBranch.set(branchId, list)
  }

  const branchOf = (issue: GraphGenerationIssue): string | null => {
    const indexMatch = issue.path?.match(/^topics\[(\d+)\]/)
    if (indexMatch) {
      const topic = orderedTopics[Number(indexMatch[1])]
      if (topic) return String(topic.branch_id)
    }
    const idMatch = issue.message.match(/"([^"]+)"/)
    if (idMatch) {
      const topic = orderedTopics.find((candidate) => String(candidate.id) === idMatch[1])
      if (topic) return String(topic.branch_id)
    }
    return null
  }

  for (const issue of issues) {
    const isEdge = EDGE_ISSUE_CODES.has(issue.code)
    const isShared = SHARED_ISSUE_CODES.has(issue.code)
    if (isEdge || isShared) edgeIssues.push(issue)
    if (!isEdge || isShared) {
      const branchId = branchOf(issue)
      if (branchId) addNode(branchId, issue)
      else for (const id of branchIds) addNode(id, issue)
    }
  }

  return { nodeByBranch, edgeIssues }
}

function assembleGraphMap(
  flat: ReturnType<typeof flattenCurriculumForGraph>,
  nodeTopics: any[],
  edges: any[],
): GeneratedGraphMap {
  const topics = nodeTopics.map((topic) => ({ ...topic, state: 'locked' }))
  const byId = new Map(topics.map((topic) => [String(topic.id), topic]))

  // Exactly one teachable leaf starts active. This is a course-global decision,
  // so it is resolved here rather than by any single per-branch step.
  let active: any = null
  for (const curriculumTopic of flat.topics) {
    const node = byId.get(curriculumTopic.id)
    if (node && String(node.node_type) !== 'container' && Number(node.children_count ?? 0) === 0) {
      active = node
      break
    }
  }
  if (!active) {
    for (const curriculumTopic of flat.topics) {
      const node = byId.get(curriculumTopic.id)
      if (node && String(node.node_type) !== 'container') { active = node; break }
    }
  }
  if (!active && topics.length) active = topics[0]
  if (active) active.state = 'active'
  const activeBranchId = active ? String(active.branch_id) : null

  const branches = flat.branches.map((branch) => {
    const topicCount = topics.filter((topic) => String(topic.branch_id) === branch.id).length
    const hasActive = activeBranchId === branch.id
    return {
      id: branch.id,
      title: branch.title,
      state: hasActive ? 'in_progress' : 'not_started',
      active_topic_id: hasActive && active ? String(active.id) : null,
      topic_count: topicCount,
      mastered_count: 0,
    }
  })

  return { branches, topics, structural_edges: edges }
}

export async function runGraphGeneration(
  input: GraphGenerationInput,
  generate: GraphGenerationExecutor,
): Promise<GraphGenerationResult> {
  const sourceEvidencePackets = input.sourceEvidencePackets
    ?? (input.mode === 'source_grounded'
      ? buildGraphSourceEvidencePackets(input.curriculum, input.sourceText)
      : [])
  const normalizedInput = { ...input, sourceEvidencePackets }
  const flat = flattenCurriculumForGraph(input.curriculum)

  function assertOwnership(result: { provider: string; model?: string }) {
    if (result.provider !== 'gemini' || result.model !== GRAPH_GENERATION_MODEL) {
      throw new Error(
        `Graph generation must run on gemini/${GRAPH_GENERATION_MODEL}; received ${result.provider}/${result.model ?? 'unknown'}.`,
      )
    }
  }

  // One continuation step: build the prompt (optionally with correction issues),
  // call the model, parse and stage-validate. A request failure (timeout, network,
  // wrong provider) has no candidate to fix, so it retries the original prompt
  // rather than a "repair" prompt with nothing attached.
  async function runStage<T>(
    label: string,
    buildPrompt: (correction: GraphGenerationIssue[] | undefined) => {
      system: string
      user: string
      responseSchema: AIResponseSchema
    },
    extract: (raw: any) => { value: T; issues: GraphGenerationIssue[] },
    seedCorrection?: GraphGenerationIssue[],
  ): Promise<T> {
    let correction = seedCorrection
    let lastIssues: GraphGenerationIssue[] = []
    let lastError: unknown

    for (let attempt = 1; attempt <= MAX_STAGE_ATTEMPTS; attempt += 1) {
      const prompt = buildPrompt(correction)
      let result: { text: string; provider: string; model?: string }
      try {
        result = await generate({
          feature: 'graph_generation',
          system: prompt.system,
          user: prompt.user,
          responseMimeType: 'application/json',
          responseSchema: prompt.responseSchema,
          signal: input.signal,
          timeoutMs: GRAPH_GENERATION_TIMEOUT_MS,
        })
        assertOwnership(result)
      } catch (error) {
        if (input.signal?.aborted) throw error
        lastError = error
        lastIssues = [{ code: 'graph_generation_request_failed', message: errorMessage(error) }]
        correction = undefined
        continue
      }

      let raw: any
      try {
        raw = extractJsonObject(result.text)
      } catch (error) {
        lastError = error
        lastIssues = [{ code: 'invalid_graph_response', message: errorMessage(error) }]
        correction = lastIssues
        continue
      }

      const { value, issues } = extract(raw)
      if (!issues.length) return value
      lastIssues = issues
      correction = issues
    }

    const detail = lastIssues.slice(0, 4).map((issue) => issue.message).join(' ')
    throw new GraphGenerationError(
      `Graph ${label} step failed after ${MAX_STAGE_ATTEMPTS} attempts.${detail ? ` ${detail}` : ''}`,
      {
        attempts: MAX_STAGE_ATTEMPTS,
        validationReport: { valid: false, issues: lastIssues, metrics: EMPTY_GRAPH_METRICS },
        cause: lastError,
      },
    )
  }

  // Map nodes branch by branch, carrying the already-mapped nodes forward as
  // context so a later branch can depend on an earlier one.
  async function mapNodes(seedByBranch?: Map<string, GraphGenerationIssue[]>): Promise<any[]> {
    const allTopics: any[] = []
    const priorNodes: Array<{ id: string; title: string; branch_id: string }> = []
    for (const branch of flat.branches) {
      const branchTopics = flat.topics.filter((topic) => topic.branch_id === branch.id)
      if (!branchTopics.length) continue
      const contextNodes = [...priorNodes]
      const topics = await runStage<any[]>(
        `node:${branch.id}`,
        (correction) => buildGraphNodeStagePrompt({
          mode: input.mode,
          branch,
          branchTopics,
          priorNodes: contextNodes,
          sourcePackets: sourceEvidencePackets,
          correctionIssues: correction,
        }),
        (raw) => {
          const emitted = Array.isArray(raw?.topics) ? raw.topics : null
          return { value: emitted ?? [], issues: validateBranchNodes(branch.id, branchTopics, emitted) }
        },
        seedByBranch?.get(branch.id),
      )
      allTopics.push(...topics)
      for (const topic of topics) {
        priorNodes.push({
          id: String(topic.id),
          title: String(topic.title ?? ''),
          branch_id: String(topic.branch_id ?? branch.id),
        })
      }
    }
    return allTopics
  }

  function mapEdges(nodes: any[], seed?: GraphGenerationIssue[]): Promise<any[]> {
    return runStage<any[]>(
      'edges',
      (correction) => buildGraphEdgeStagePrompt({
        mode: input.mode,
        nodes,
        sourcePackets: sourceEvidencePackets,
        correctionIssues: correction,
      }),
      (raw) => {
        const emitted = Array.isArray(raw?.structural_edges) ? raw.structural_edges : null
        return {
          value: emitted ?? [],
          issues: emitted
            ? []
            : [{ code: 'invalid_graph_response', message: 'Edge step did not return a structural_edges array.' }],
        }
      },
      seed,
    )
  }

  let nodes = await mapNodes()
  let edges = await mapEdges(nodes)
  let map = assembleGraphMap(flat, nodes, edges)
  let report = validateGeneratedCourseGraph(normalizedInput, map)

  let round = 1
  while (!report.valid && round < MAX_ROUNDS) {
    round += 1
    const { nodeByBranch, edgeIssues } = classifyIssues(report.issues, map.topics, flat.branches.map((b) => b.id))
    if (nodeByBranch.size) nodes = await mapNodes(nodeByBranch)
    if (nodeByBranch.size || edgeIssues.length) {
      edges = await mapEdges(nodes, edgeIssues.length ? edgeIssues : undefined)
    }
    map = assembleGraphMap(flat, nodes, edges)
    report = validateGeneratedCourseGraph(normalizedInput, map)
  }

  if (report.valid) {
    const provenance: GraphGenerationProvenance = {
      schema_version: GRAPH_GENERATION_SCHEMA_VERSION,
      provider: 'gemini',
      model: GRAPH_GENERATION_MODEL,
      generated_at: new Date().toISOString(),
      generation_origin: 'generated',
      generation_revision: Math.max(1, Number(input.generationRevision ?? 1)),
      curriculum_fingerprint: fingerprint(input.curriculum),
      source_fingerprint: input.mode === 'source_grounded'
        ? fingerprint(sourceEvidencePackets)
        : null,
      attempts: round,
      validation_report: report,
    }
    map.provenance = provenance
    map.validation_report = report
    return { map, sourceEvidencePackets, provenance }
  }

  const detail = report.issues.slice(0, 4).map((issue) => issue.message).join(' ')
  throw new GraphGenerationError(
    `Gemini could not produce a valid course graph after ${round} attempts.${detail ? ` ${detail}` : ''}`,
    { attempts: round, validationReport: report },
  )
}
