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

export function transformToGraphData(params: {
  courseId: string
  courseTitle: string
  topics: RawTopic[]
  branches: RawBranch[]
  topicEdges: RawTopicEdge[]
  activeSingleTopicId?: string | null
}): GraphData {
  const { courseId, courseTitle, topics, branches, topicEdges, activeSingleTopicId } = params

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

  // ── Compute layout ──
  const layoutNodes = topics.map((t) => ({
    id: String(t._id),
    branch_id: String(t.branch_id),
    position: Number(t.position ?? 0),
  }))

  const layoutEdges = rawEdges.map((e) => ({ from: e.from, to: e.to }))
  const { positions, canvasW, canvasH } = computeLayout(layoutNodes, layoutEdges)

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
      state: toGraphState(t.state),
      difficulty: toDifficulty(t.estimated_pages),
      mastery: toMastery(t.understanding_level),
      suggested: Boolean(t.suggested),
      misconception: Boolean(t.misconception),
      current: activeSingleTopicId ? id === activeSingleTopicId : Boolean(t.current),
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

  return { course, branches: graphBranches, nodes, edges, canvasW, canvasH }
}
