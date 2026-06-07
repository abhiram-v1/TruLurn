// Transform raw MongoDB documents into the GraphData shape the renderer expects.

import { computeLayout } from './layout'
import type {
  GraphData,
  GraphNode,
  GraphEdge,
  GraphBranch,
  GraphCourse,
  GraphNodeState,
  EdgeStrength,
} from './types'

// ── Helpers ────────────────────────────────────────────────────────────────

/** Map TopicState (MongoDB) → GraphNodeState (renderer). */
function toGraphState(state: string): GraphNodeState {
  const map: Record<string, GraphNodeState> = {
    locked: 'locked',
    active: 'active',
    done: 'mastered',
    mastered: 'mastered',
    functional: 'functional',
    partial: 'partial',
    unstable: 'unstable',
  }
  return map[state] ?? 'locked'
}

/** Map understanding_level (1–5) → mastery percentage (0–100). */
function toMastery(level: number | null | undefined): number {
  if (!level) return 0
  return Math.min(100, Math.round(level * 20))
}

/** Derive a visual importance tier from the topic's position in its branch.
 *  First topic → 3 (large), next few → 2, rest → 1. */
function toImportance(position: number): 1 | 2 | 3 {
  if (position === 0) return 3
  if (position <= 2) return 2
  return 1
}

/** Derive difficulty from estimated_pages (or fallback). */
function toDifficulty(estimatedPages: number | null | undefined): number {
  if (!estimatedPages) return 3
  if (estimatedPages <= 2) return 2
  if (estimatedPages <= 4) return 3
  if (estimatedPages <= 6) return 4
  return 5
}

/** Map branch state → css color hint for the sidebar dot. */
function toBranchColor(state: string, mastered: number, total: number): string {
  if (state === 'mastered') return 'mastered'
  if (state === 'in_progress') return mastered > 0 ? 'partial' : 'active'
  return 'locked'
}

/** Numeric strength (from topicEdges) → string */
function toStrength(s: number | string | undefined): EdgeStrength {
  if (s === 'strong' || s === 'medium' || s === 'weak') return s
  const n = Number(s)
  if (n >= 3) return 'strong'
  if (n === 2) return 'medium'
  return 'weak'
}

// ── Main transform ─────────────────────────────────────────────────────────

export interface RawTopic {
  _id: unknown
  course_id: string
  branch_id: string
  section: string
  title: string
  position: number
  state: string
  understanding_level?: number | null
  prerequisites?: string[]
  estimated_pages?: number | null
  suggested?: boolean
  misconception?: boolean
  current?: boolean
  created_at: Date
}

export interface RawBranch {
  _id: unknown
  branch_key?: string
  course_id: string
  title: string
  description?: string
  state: string
  active_topic_id?: string | null
  topic_count: number
  mastered_count: number
}

export interface RawTopicEdge {
  from_topic_id: string
  to_topic_id: string
  strength?: number | string
  reason?: string | null
  edge_type?: string | null
}

// ── Intelligence metric helpers ────────────────────────────────────────────

/** State → own vulnerability contribution (risk seeded before cascade). */
function ownRisk(state: string): number {
  if (state === 'unstable') return 80
  if (state === 'partial')  return 42
  if (state === 'active')   return 8   // untested — small inherent uncertainty
  return 0
}

/** Compute vulnerability risk for every node via forward-BFS cascade.
 *  A weak/unstable prerequisite propagates its risk to all downstream nodes,
 *  attenuated by 0.78 per hop so that distant nodes still carry a signal
 *  but the source of the problem is clearly the most affected. */
function computeVulnerabilityRisks(
  ids: string[],
  stateMap: Map<string, string>,
  fwdAdj: Map<string, string[]>,
): Map<string, number> {
  const risk = new Map<string, number>()
  for (const id of ids) risk.set(id, ownRisk(stateMap.get(id) ?? 'locked'))

  // Topological BFS — propagate from highest-risk sources outward
  const queue = [...ids].filter((id) => (risk.get(id) ?? 0) > 0)
  const visited = new Set<string>()
  while (queue.length) {
    const id = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    const myRisk = risk.get(id) ?? 0
    if (myRisk <= 2) continue
    for (const next of fwdAdj.get(id) ?? []) {
      const propagated = myRisk * 0.78
      if ((risk.get(next) ?? 0) < propagated) {
        risk.set(next, propagated)
        queue.push(next)
      }
    }
  }

  return risk
}

/** For each node, count reachable locked downstream nodes (bottleneck score). */
function computeDownstreamImpact(
  ids: string[],
  stateMap: Map<string, string>,
  fwdAdj: Map<string, string[]>,
): Map<string, number> {
  const impact = new Map<string, number>()
  for (const id of ids) {
    let count = 0
    const seen = new Set<string>()
    const q = [id]
    while (q.length) {
      const cur = q.shift()!
      for (const next of fwdAdj.get(cur) ?? []) {
        if (seen.has(next)) continue
        seen.add(next)
        if (stateMap.get(next) === 'locked') count++
        q.push(next)
      }
    }
    impact.set(id, count)
  }
  return impact
}

/** Decay score 0–100. Only meaningful for mastered/functional/partial nodes. */
function computeDecayScore(state: string, lastActivityAt: Date | null): number {
  if (!['mastered', 'functional', 'partial'].includes(state)) return 100
  if (!lastActivityAt) return 30 // never reviewed → stale

  const daysSince = (Date.now() - lastActivityAt.getTime()) / 86_400_000

  // Different decay rates by state: mastered decays slower than partial
  const halfLifeDays = state === 'mastered' ? 45 : state === 'functional' ? 28 : 14
  const lambda = Math.LN2 / halfLifeDays
  return Math.round(Math.max(0, 100 * Math.exp(-lambda * daysSince)))
}

export function transformToGraphData(params: {
  courseId: string
  courseTitle: string
  topics: RawTopic[]
  branches: RawBranch[]
  topicEdges: RawTopicEdge[]
  activeSingleTopicId?: string | null
  lastExamByTopic?: Map<string, { completedAt: Date; falseConfidence: boolean }>
  doubtCountByTopic?: Map<string, number>
}): GraphData {
  const {
    courseId, courseTitle, topics, branches, topicEdges, activeSingleTopicId,
    lastExamByTopic = new Map(),
    doubtCountByTopic = new Map(),
  } = params

  // ── Build raw edge list from topicEdges + prerequisites ──
  const edgeSet = new Set<string>() // dedup key: `from::to`
  const rawEdges: Array<{ from: string; to: string; strength: EdgeStrength; critical: boolean }> = []

  function addEdge(from: string, to: string, strength: EdgeStrength, critical: boolean) {
    const key = `${from}::${to}`
    if (edgeSet.has(key)) return
    edgeSet.add(key)
    rawEdges.push({ from, to, strength, critical })
  }

  // From topicEdges collection
  for (const e of topicEdges) {
    if (String(e.edge_type ?? 'semantic') === 'hierarchy') continue
    addEdge(e.from_topic_id, e.to_topic_id, toStrength(e.strength), false)
  }

  // From prerequisites on topics (fills in gaps when topicEdges is empty)
  for (const t of topics) {
    const topicId = String(t._id)
    for (const prereqId of t.prerequisites ?? []) {
      addEdge(prereqId, topicId, 'strong', false)
    }
  }

  // ── Build forward adjacency for intelligence metrics ──
  const stateMap = new Map(topics.map((t) => [String(t._id), String(t.state ?? 'locked')]))
  const fwdAdj = new Map<string, string[]>()
  for (const t of topics) fwdAdj.set(String(t._id), [])
  for (const e of rawEdges) {
    fwdAdj.get(e.from)?.push(e.to)
  }
  // Also include prerequisite relationships from topics themselves
  for (const t of topics) {
    const id = String(t._id)
    for (const prereqId of t.prerequisites ?? []) {
      const pid = String(prereqId)
      if (!fwdAdj.has(pid)) fwdAdj.set(pid, [])
      if (!fwdAdj.get(pid)!.includes(id)) fwdAdj.get(pid)!.push(id)
    }
  }

  const topicIds = topics.map((t) => String(t._id))
  const vulnerabilityRisks = computeVulnerabilityRisks(topicIds, stateMap, fwdAdj)
  const downstreamImpacts  = computeDownstreamImpact(topicIds, stateMap, fwdAdj)

  // ── Compute layout ──
  const layoutNodes = topics.map((t) => ({
    id: String(t._id),
    branch_id: String(t.branch_id),
    position: Number(t.position ?? 0),
  }))

  const layoutEdges = rawEdges.map((e) => ({ from: e.from, to: e.to }))
  const { positions, canvasW, canvasH, regions: rawRegions } = computeLayout(layoutNodes, layoutEdges)

  // Build branch_key → branch title map
  const branchTitleMap = new Map<string, string>()
  for (const b of branches) {
    const key = String(b.branch_key ?? b._id)
    branchTitleMap.set(key, b.title)
    // Also map the full _id string in case branch_id is stored as the full _id
    branchTitleMap.set(String(b._id), b.title)
  }

  // ── Graph nodes ──
  const nodes: GraphNode[] = topics.map((t) => {
    const id = String(t._id)
    const pos = positions.get(id) ?? { x: 60, y: 60, w: 178 }
    const branchKey = String(t.branch_id)
    const state = toGraphState(t.state)
    const exam = lastExamByTopic.get(id) ?? null
    const lastActivity = exam?.completedAt ?? (t.created_at instanceof Date ? t.created_at : null)

    return {
      id,
      title: t.title,
      branch: branchKey,
      branchTitle: branchTitleMap.get(branchKey) ?? branchKey,
      section: t.section ?? '',
      x: pos.x,
      y: pos.y,
      w: pos.w,
      importance: toImportance(Number(t.position ?? 0)),
      state,
      difficulty: toDifficulty(t.estimated_pages),
      mastery: toMastery(t.understanding_level),
      suggested: Boolean(t.suggested),
      misconception: Boolean(t.misconception),
      current: activeSingleTopicId ? id === activeSingleTopicId : Boolean(t.current),
      // Intelligence layer
      vulnerabilityRisk: Math.round(vulnerabilityRisks.get(id) ?? 0),
      downstreamImpact:  downstreamImpacts.get(id) ?? 0,
      decayScore:        computeDecayScore(String(t.state), lastActivity),
      doubtCount:        doubtCountByTopic.get(id) ?? 0,
      falseConfidence:   exam?.falseConfidence ?? false,
    }
  })

  // ── Graph edges ──
  const nodeIds = new Set(nodes.map((n) => n.id))
  const edges: GraphEdge[] = rawEdges.filter(
    (e) => nodeIds.has(e.from) && nodeIds.has(e.to),
  )

  // ── Branches ──
  const graphBranches: GraphBranch[] = branches.map((b) => {
    const key = String(b.branch_key ?? b._id)
    const mastered = b.mastered_count ?? 0
    const total = b.topic_count ?? 0
    return {
      id: key,
      title: b.title,
      description: b.description ?? b.title,
      topicCount: total,
      mastered,
      color: toBranchColor(b.state, mastered, total),
      active: b.state === 'in_progress',
    }
  })

  // ── Course summary counts ──
  const counts = { mastered: 0, functional: 0, partial: 0, unstable: 0, active: 0, locked: 0 }
  for (const n of nodes) counts[n.state] = (counts[n.state] ?? 0) + 1

  const course: GraphCourse = {
    id: courseId,
    title: courseTitle,
    topicCount: nodes.length,
    ...counts,
  }

  // Resolve region labels — replace raw branch_id with the real branch title
  const regions = rawRegions.map((r) => ({
    ...r,
    label: branchTitleMap.get(r.id) ?? r.id,
  }))

  return { course, branches: graphBranches, nodes, edges, canvasW, canvasH, regions }
}
