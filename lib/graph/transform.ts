// Transform raw MongoDB documents into the GraphData shape the renderer expects.

import { computeLayout, type RawNode as LayoutRawNode } from './layout.ts'
import { dependencyAdjacency, isHardPrerequisite, longestDependencyPath } from './edges.ts'
import { levelToMasteryPercent } from './mastery.ts'
import type {
  GraphData,
  GraphNode,
  GraphNodeType,
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
const toMastery = levelToMasteryPercent

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
function toBranchColor(state: string, mastered: number): string {
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
  sequence_index?: number | null
  // containment-tree fields (recursive-spine classification)
  parent_id?: string | null
  path_ids?: string[] | null
  node_type?: string | null
  children_count?: number | null
  depth_level?: number | null
  // AI-emitted graph tags (optional; fall back to heuristics when absent)
  prerequisite_strength?: Record<string, string> | null
  importance_tag?: string | null
  role?: string | null
  spine_candidate?: boolean | null
  spine_level?: number | null
  state: string
  understanding_level?: number | null
  prerequisites?: string[]
  recommended_next_ids?: string[]
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

/** A learner-created connection between two concepts (userConnections doc). */
export interface RawUserConnection {
  _id: unknown
  from_topic_id: string
  to_topic_id: string
  note?: string | null
}

/** Per-topic recall-break stats (topics.recall_stats). */
export interface RawRecallStats {
  attempts: number
  hits: number
  misses: number
}

/**
 * Rebuild the minimum containment metadata needed by the island layout for
 * courses saved before recursive hierarchy fields were persisted.
 */
export function normalizeGraphTopicHierarchy(topics: RawTopic[]): RawTopic[] {
  const topicIds = new Set(topics.map((topic) => String(topic._id)))
  const normalized = topics.map((topic) => ({ ...topic }))

  for (const topic of normalized) {
    if (topic.parent_id || !Array.isArray(topic.path_ids)) continue
    const pathIds = topic.path_ids.map(String)
    const topicId = String(topic._id)
    const parentCandidate = pathIds.at(-1) === topicId ? pathIds.at(-2) : pathIds.at(-1)
    if (parentCandidate && parentCandidate !== topicId && topicIds.has(parentCandidate)) {
      topic.parent_id = parentCandidate
    }
  }

  const childCountByParent = new Map<string, number>()
  for (const topic of normalized) {
    if (!topic.parent_id || !topicIds.has(String(topic.parent_id))) continue
    const parentId = String(topic.parent_id)
    childCountByParent.set(parentId, (childCountByParent.get(parentId) ?? 0) + 1)
  }

  return normalized.map((topic) => {
    const inferredChildren = childCountByParent.get(String(topic._id)) ?? 0
    const storedChildren = Number(topic.children_count)
    const childrenCount = Math.max(
      Number.isFinite(storedChildren) ? storedChildren : 0,
      inferredChildren,
    )
    const storedType = String(topic.node_type ?? '').trim()

    return {
      ...topic,
      node_type: storedType === 'container' || childrenCount > 0
        ? 'container'
        : storedType || 'learning_unit',
      children_count: childrenCount,
      depth_level: Number.isFinite(Number(topic.depth_level))
        ? Number(topic.depth_level)
        : 0,
      sequence_index: topic.sequence_index != null && Number.isFinite(Number(topic.sequence_index))
        ? Number(topic.sequence_index)
        : Number(topic.position ?? 0),
    }
  })
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

  // Relaxation queue — re-process a node every time its risk value actually
  // increases, not just the first time it's dequeued. A `visited` set that
  // blocks reprocessing forever would let a node propagate a stale, too-low
  // value once and then freeze — a later-discovered higher-risk path into the
  // same node would update its OWN value but never get the chance to
  // propagate the increase further downstream. The 0.78 per-hop decay
  // guarantees this still terminates even if a prerequisite cycle exists.
  const queue = [...ids].filter((id) => (risk.get(id) ?? 0) > 0)
  while (queue.length) {
    const id = queue.shift()!
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

// ── Progress engine ────────────────────────────────────────────────────────

// NOT the same axis as toMastery/levelToMasteryPercent (node.mastery, derived
// from the granular 1-5 understanding_level). This is a deliberately coarser,
// state-bucket score used only for branch/course AVERAGES — a 'functional'
// topic contributes a flat 70 here regardless of whether its own
// understanding_level is 3 (60%) or 4 (80%), so a single regrade doesn't
// jolt the aggregate. The two can legitimately disagree for the same topic;
// that's intentional, not a bug to reconcile.
/** Weighted mastery contribution per state (0–100 scale). */
const MASTERY_WEIGHTS: Record<GraphNodeState, number> = {
  mastered:   100,
  functional:  70,
  partial:     35,
  unstable:    20,
  active:       5,
  locked:       0,
}

/** Average weighted mastery across a set of nodes (0–100, rounded). */
function weightedMastery(nodes: GraphNode[]): number {
  if (!nodes.length) return 0
  const sum = nodes.reduce((acc, n) => acc + MASTERY_WEIGHTS[n.state], 0)
  return Math.round(sum / nodes.length)
}

/**
 * Pick the single highest-priority node for the learner to study next.
 *
 * Priority cascade:
 *   1. Unstable   — most decayed first (lowest decayScore)
 *   2. Partial or fading functional (decayScore < 50) — highest downstream impact
 *   3. Active     — continue current learning path
 *   4. Locked with all prerequisites solid — highest downstream impact
 *   5. null       — nothing actionable
 */
function pickNextBestNode(
  nodes: GraphNode[],
  edges: Array<{ from: string; to: string }>,
): string | null {
  // Build direct-prerequisite map (edges pointing TO a node represent prereqs)
  const prereqsOf = new Map<string, Set<string>>()
  for (const n of nodes) prereqsOf.set(n.id, new Set())
  for (const e of edges) {
    prereqsOf.get(e.to)?.add(e.from)
  }
  const stateOf = new Map(nodes.map((n) => [n.id, n.state]))

  /** All direct prereqs are mastered or functional → ready to unlock */
  function prereqsSolid(nodeId: string): boolean {
    const prereqs = prereqsOf.get(nodeId)
    if (!prereqs || prereqs.size === 0) return true
    for (const pid of prereqs) {
      const s = stateOf.get(pid)
      if (s !== 'mastered' && s !== 'functional') return false
    }
    return true
  }

  // 1. Unstable — reinforcement needed (most decayed first)
  const unstable = nodes.filter((n) => n.state === 'unstable')
  if (unstable.length) {
    return unstable.sort((a, b) => a.decayScore - b.decayScore)[0].id
  }

  // 2. Partial or fading functional — high decay risk
  const atRisk = nodes.filter(
    (n) => n.state === 'partial' || (n.state === 'functional' && n.decayScore < 50),
  )
  if (atRisk.length) {
    return atRisk.sort((a, b) => b.downstreamImpact - a.downstreamImpact)[0].id
  }

  // 3. Active — continue current
  const active = nodes.find((n) => n.state === 'active')
  if (active) return active.id

  // 4. Locked but all prereqs solid — highest bottleneck value
  const readyLocked = nodes
    .filter((n) => n.state === 'locked' && prereqsSolid(n.id))
    .sort((a, b) => b.downstreamImpact - a.downstreamImpact)
  if (readyLocked.length) return readyLocked[0].id

  return null
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
  userConnections?: RawUserConnection[]
  recallStatsByTopic?: Map<string, RawRecallStats>
}): GraphData {
  const {
    courseId, courseTitle, topics: rawTopics, branches, topicEdges, activeSingleTopicId,
    lastExamByTopic = new Map(),
    doubtCountByTopic = new Map(),
    userConnections = [],
    recallStatsByTopic = new Map(),
  } = params
  const topics = normalizeGraphTopicHierarchy(rawTopics)

  // ── Prerequisite-strength lookup (AI-tagged): `${from}::${to}` → hard | soft ──
  const prereqStrengthByEdge = new Map<string, 'hard' | 'soft'>()
  for (const t of topics) {
    const topicId = String(t._id)
    const map = t.prerequisite_strength
    if (!map || typeof map !== 'object') continue
    for (const [prereqId, strength] of Object.entries(map)) {
      if (strength === 'hard' || strength === 'soft') {
        prereqStrengthByEdge.set(`${String(prereqId)}::${topicId}`, strength)
      }
    }
  }

  // ── Build raw edge list from topicEdges + prerequisites ──
  type RawGraphEdge = {
    from: string
    to: string
    strength: EdgeStrength
    critical: boolean
    edgeType: string
    prereqStrength: 'hard' | 'soft' | null
  }
  const edgeByPair = new Map<string, RawGraphEdge>()
  const edgePriority: Record<string, number> = {
    prerequisite: 4,
    sequence: 3,
    recommended: 2,
    semantic: 1,
  }

  function addEdge(from: string, to: string, strength: EdgeStrength, critical: boolean, edgeType = 'semantic') {
    const key = `${from}::${to}`
    const prereqStrength = edgeType === 'prerequisite' ? (prereqStrengthByEdge.get(key) ?? null) : null
    const existing = edgeByPair.get(key)
    if (existing && (edgePriority[existing.edgeType] ?? 0) >= (edgePriority[edgeType] ?? 0)) return
    // Dedup is keyed by direction (`from::to`), so an edge and its reverse
    // (`to::from`) were previously treated as unrelated and both survived —
    // rendering two opposite-pointing arrows between the same pair. Keep only
    // the higher-priority direction; an equal-or-higher-priority reverse edge
    // wins and this insert is dropped.
    const reverse = edgeByPair.get(`${to}::${from}`)
    if (reverse && (edgePriority[reverse.edgeType] ?? 0) >= (edgePriority[edgeType] ?? 0)) return
    edgeByPair.set(key, { from, to, strength, critical, edgeType, prereqStrength })
  }

  // From topicEdges collection — hierarchy edges are retired (replaced by sequence edges);
  // skip any that remain in existing courses, and drop any unknown types.
  const VISIBLE_EDGE_TYPES = new Set(['sequence', 'prerequisite', 'recommended', 'semantic'])
  for (const e of topicEdges) {
    if (!VISIBLE_EDGE_TYPES.has(String(e.edge_type ?? 'semantic'))) continue
    addEdge(e.from_topic_id, e.to_topic_id, toStrength(e.strength), false, String(e.edge_type ?? 'semantic'))
  }

  // From prerequisites on topics (fills in gaps when topicEdges is empty)
  for (const t of topics) {
    const topicId = String(t._id)
    for (const prereqId of t.prerequisites ?? []) {
      addEdge(prereqId, topicId, 'strong', false, 'prerequisite')
    }
    for (const nextId of t.recommended_next_ids ?? []) {
      addEdge(topicId, String(nextId), 'medium', false, 'recommended')
    }
  }
  const rawEdges = [...edgeByPair.values()]

  // ── Build forward adjacency for intelligence metrics ──
  // ONLY hard prerequisite edges are a dependency (see lib/graph/edges.ts).
  // `sequence` records study/upload order, not "must understand first" —
  // counting it here previously inflated downstreamImpact ("N concepts depend
  // on this") and cascaded vulnerability risk onto nodes that merely come
  // later, not nodes that actually build on the weak concept. rawEdges already
  // includes every topic.prerequisites entry (added above), so no separate merge is needed.
  const stateMap = new Map(topics.map((t) => [String(t._id), String(t.state ?? 'locked')]))
  const topicIds = topics.map((t) => String(t._id))
  const fwdAdj = dependencyAdjacency(rawEdges, topicIds)
  const vulnerabilityRisks = computeVulnerabilityRisks(topicIds, stateMap, fwdAdj)
  const downstreamImpacts  = computeDownstreamImpact(topicIds, stateMap, fwdAdj)

  // Build branch_key → branch title map (needed by the layout for box labels)
  const branchTitleMap = new Map<string, string>()
  for (const b of branches) {
    const key = String(b.branch_key ?? b._id)
    branchTitleMap.set(key, b.title)
    branchTitleMap.set(String(b._id), b.title)
  }

  // Importance: prefer the AI tag (core/supporting), fall back to position heuristic.
  const importanceOf = (t: RawTopic): 1 | 2 | 3 =>
    t.importance_tag === 'core' ? 3
    : t.importance_tag === 'supporting' ? 1
    : toImportance(Number(t.position ?? 0))
  const isTeachable = (t: RawTopic) =>
    String(t.node_type ?? 'learning_unit') !== 'container' && Number(t.children_count ?? 0) <= 0

  // ── Compute recursive-spine layout ──
  const layoutNodes: LayoutRawNode[] = topics.map((t) => ({
    id: String(t._id),
    branch_id: String(t.branch_id),
    parent_id: t.parent_id ? String(t.parent_id) : null,
    node_type: String(t.node_type ?? 'learning_unit'),
    children_count: Number(t.children_count ?? 0),
    depth_level: Number(t.depth_level ?? 0),
    sequence_index: Number(t.sequence_index ?? t.position ?? 0),
    position: Number(t.position ?? 0),
    importance: importanceOf(t),
    title: t.title,
    section: t.section ?? '',
    spine_candidate: Boolean(t.spine_candidate),
    spine_level: Number.isFinite(t.spine_level) ? Number(t.spine_level) : undefined,
  }))

  const layoutEdges = rawEdges.map((edge) => ({
    from: edge.from,
    to: edge.to,
    edgeType: edge.edgeType,
    prereqStrength: edge.prereqStrength,
  }))
  const { positions, boxes, canvasW, canvasH } = computeLayout(layoutNodes, branchTitleMap, layoutEdges)

  // ── Convergence detection (DAG) ──
  // A node that is a prerequisite for nodes spanning ≥2 distinct branch families
  // is a derived-spine candidate (promotable branch node).
  const branchOf = new Map(topics.map((t) => [String(t._id), String(t.branch_id)]))
  const prereqTargetFamilies = new Map<string, Set<string>>()
  for (const e of rawEdges) {
    if (e.edgeType !== 'prerequisite') continue
    const fam = branchOf.get(e.to)
    if (!fam) continue
    if (!prereqTargetFamilies.has(e.from)) prereqTargetFamilies.set(e.from, new Set())
    prereqTargetFamilies.get(e.from)!.add(fam)
  }
  const convergenceIds = new Set<string>()
  for (const [id, fams] of prereqTargetFamilies) if (fams.size >= 2) convergenceIds.add(id)

  // AI-tagged spine candidates (preferred over the DAG heuristic when present)
  const spineCandidateIds = new Set<string>()
  for (const t of topics) if (t.spine_candidate) spineCandidateIds.add(String(t._id))

  // family → colour ramp (from the boxes the layout produced)
  const familyRamp = new Map<string, string>()
  for (const box of boxes) familyRamp.set(box.family, box.colourRamp)

  const classify = (id: string, role: string, spineLevel: number): GraphNodeType => {
    if (role === 'spine') return spineLevel === 0 ? 'spine_original' : 'spine_derived'
    // A leaf becomes a (promotable) derived spine if the AI tagged it or the DAG
    // shows it converging multiple branches.
    if (spineCandidateIds.has(id) || convergenceIds.has(id)) return 'spine_derived'
    return 'branch'
  }

  // ── Knowledge strength inputs ──
  // Count of user-made connections touching each node — each one is evidence
  // the learner integrated the concept, so it strengthens the node.
  const userConnCountByTopic = new Map<string, number>()
  for (const conn of userConnections) {
    for (const id of [String(conn.from_topic_id), String(conn.to_topic_id)]) {
      userConnCountByTopic.set(id, (userConnCountByTopic.get(id) ?? 0) + 1)
    }
  }

  /** 0–100 earned strength: mastery state + recall performance + freshness + connections. */
  function computeKnowledgeStrength(id: string, state: GraphNodeState, decayScore: number): number {
    const base = MASTERY_WEIGHTS[state]
    const recall = recallStatsByTopic.get(id)
    const recallScore = recall && recall.attempts > 0
      ? Math.round((recall.hits / recall.attempts) * 100)
      : base
    const connBoost = Math.min(12, (userConnCountByTopic.get(id) ?? 0) * 4)
    // decayScore (freshness) only means something once a node has actually been
    // studied — computeDecayScore returns a flat 100 for every other state,
    // which previously inflated locked/active nodes with phantom "freshness"
    // they never earned.
    const decayApplies = state === 'mastered' || state === 'functional' || state === 'partial'
    const strength = 0.5 * base + 0.3 * recallScore + (decayApplies ? 0.2 * decayScore : 0) + connBoost
    return Math.max(0, Math.min(100, Math.round(strength)))
  }

  // ── Graph nodes ──
  // Topics that became BOXES (containers of leaves) are NOT rendered as cards —
  // they are GraphBoxes. Only spine containers and leaves get node cards.
  const nodes: GraphNode[] = []
  for (const t of topics) {
    const id = String(t._id)
    const pos = positions.get(id)
    if (!pos) continue // box container → represented as a GraphBox
    const branchKey = String(t.branch_id)
    const state = toGraphState(t.state)
    const exam = lastExamByTopic.get(id) ?? null
    const lastActivity = exam?.completedAt ?? (t.created_at instanceof Date ? t.created_at : null)
    const ramp = familyRamp.get(branchKey) ?? 'blue'
    const decayScore = computeDecayScore(String(t.state), lastActivity)

    nodes.push({
      id,
      title: t.title,
      branch: branchKey,
      branchTitle: branchTitleMap.get(branchKey) ?? branchKey,
      section: t.section ?? '',
      x: pos.x,
      y: pos.y,
      w: pos.w,
      h: pos.h,
      importance: importanceOf(t),
      // Recursive-spine metadata
      nodeType: classify(id, pos.role, pos.spineLevel),
      spineLevel: pos.spineLevel,
      layer: pos.layer,
      branchFamily: branchKey,
      colourRamp: ramp,
      boxId: pos.boxId,
      positionInBox: pos.positionInBox,
      isConvergence: convergenceIds.has(id) || spineCandidateIds.has(id),
      teachable: isTeachable(t),
      // AI pedagogical tags
      role: t.role ?? null,
      importanceTag: t.importance_tag === 'core' || t.importance_tag === 'supporting' ? t.importance_tag : null,
      state,
      difficulty: toDifficulty(t.estimated_pages),
      mastery: toMastery(t.understanding_level),
      suggested: Boolean(t.suggested),
      misconception: Boolean(t.misconception),
      current: activeSingleTopicId ? id === activeSingleTopicId : Boolean(t.current),
      // Intelligence layer
      vulnerabilityRisk: Math.round(vulnerabilityRisks.get(id) ?? 0),
      downstreamImpact:  downstreamImpacts.get(id) ?? 0,
      decayScore,
      doubtCount:        doubtCountByTopic.get(id) ?? 0,
      falseConfidence:   exam?.falseConfidence ?? false,
      knowledgeStrength: computeKnowledgeStrength(id, state, decayScore),
    })
  }

  // ── Graph edges ──
  const nodeIds = new Set(nodes.map((n) => n.id))

  // A box-container (organizational, not rendered as a card) can still be an
  // edge endpoint if the AI referenced it as a prerequisite/dependency. Rather
  // than silently dropping that relationship when the filter below requires
  // both endpoints to be rendered nodes, redirect it to the container's
  // nearest teachable descendant (tree order). A container with no teachable
  // descendant at all has nothing sensible to redirect to, and the edge is
  // dropped, same as before.
  const childrenByParent = new Map<string, string[]>()
  for (const t of topics) {
    const parentId = t.parent_id ? String(t.parent_id) : null
    if (!parentId) continue
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, [])
    childrenByParent.get(parentId)!.push(String(t._id))
  }
  const descendantCache = new Map<string, string | null>()
  function nearestTeachableDescendant(id: string, seen = new Set<string>()): string | null {
    if (seen.has(id)) return null // guards against a cyclic parent_id
    if (descendantCache.has(id)) return descendantCache.get(id)!
    seen.add(id)
    let resolved: string | null = null
    for (const childId of childrenByParent.get(id) ?? []) {
      if (positions.get(childId)) { resolved = childId; break }
      const fromChild = nearestTeachableDescendant(childId, seen)
      if (fromChild) { resolved = fromChild; break }
    }
    descendantCache.set(id, resolved)
    return resolved
  }
  function redirectToRenderedNode(id: string): string | null {
    if (positions.get(id)) return id // already a rendered node (leaf or spine container)
    return nearestTeachableDescendant(id)
  }
  const reparentedEdges = rawEdges
    .map((e) => {
      const from = redirectToRenderedNode(e.from)
      const to = redirectToRenderedNode(e.to)
      if (!from || !to || from === to) return null
      return from === e.from && to === e.to ? e : { ...e, from, to }
    })
    .filter((e): e is typeof rawEdges[number] => e !== null)

  const edges: GraphEdge[] = reparentedEdges.filter(
    (e) => nodeIds.has(e.from) && nodeIds.has(e.to),
  )

  // User-created knowledge connections — first-class edges in the personal
  // graph. They are associations the learner made, never dependencies, so they
  // stay out of fwdAdj/critical-path math entirely.
  for (const conn of userConnections) {
    const from = String(conn.from_topic_id)
    const to = String(conn.to_topic_id)
    if (!nodeIds.has(from) || !nodeIds.has(to) || from === to) continue
    edges.push({
      from,
      to,
      strength: 'strong',
      critical: false,
      edgeType: 'user',
      prereqStrength: null,
      note: conn.note ? String(conn.note) : null,
      connectionId: String(conn._id),
    })
  }
  const teachableNodes = nodes.filter((node) => node.teachable)
  const teachableNodeIds = new Set(teachableNodes.map((node) => node.id))
  const evidenceEdges = edges.filter(
    (edge) =>
      teachableNodeIds.has(edge.from)
      && teachableNodeIds.has(edge.to)
      && ['prerequisite', 'sequence'].includes(edge.edgeType),
  )

  // ── Branches ──
  const graphBranches: GraphBranch[] = branches.map((b) => {
    const key = String(b.branch_key ?? b._id)
    const mastered = b.mastered_count ?? 0
    const total = b.topic_count ?? 0
    const branchNodes = teachableNodes.filter((n) => n.branch === key)
    return {
      id: key,
      title: b.title,
      description: b.description ?? b.title,
      topicCount: total,
      mastered,
      color: toBranchColor(b.state, mastered),
      active: b.state === 'in_progress',
      masteryScore: weightedMastery(branchNodes),
    }
  })

  // ── Course summary counts ──
  const counts = { mastered: 0, functional: 0, partial: 0, unstable: 0, active: 0, locked: 0 }
  for (const n of teachableNodes) counts[n.state] = (counts[n.state] ?? 0) + 1

  // ── Connectivity metrics ──
  const connectedNodeIds = new Set<string>()
  for (const e of evidenceEdges) {
    connectedNodeIds.add(e.from)
    connectedNodeIds.add(e.to)
  }
  const connectedCount = connectedNodeIds.size
  const isolatedCount = teachableNodes.length - connectedCount

  // ── Next Best Node + suggested flag override ──
  // "All prerequisites solid" must mean hard prerequisites only — a sequence
  // edge (study order) satisfied does not mean a dependency is satisfied.
  const unlockDependencyEdges = evidenceEdges.filter(isHardPrerequisite)
  const nextBestNodeId = pickNextBestNode(teachableNodes, unlockDependencyEdges)
  // Clear all DB-sourced suggested flags and set only the computed winner
  for (const n of nodes) {
    n.suggested = n.id === nextBestNodeId
  }

  // ── Critical path — the longest HARD-prerequisite chain (the learning spine) ──
  // Restricted to edges between two teachable nodes, matching how the spine is
  // meant to read (a chain of learning units, not containers).
  const criticalPath = longestDependencyPath(
    teachableNodes.map((n) => n.id),
    edges.filter((e) => teachableNodeIds.has(e.from) && teachableNodeIds.has(e.to)),
  )

  const course: GraphCourse = {
    id: courseId,
    title: courseTitle,
    topicCount: teachableNodes.length,
    ...counts,
    masteryScore: weightedMastery(teachableNodes),
    connectedCount,
    isolatedCount,
  }

  return { course, branches: graphBranches, nodes, edges, boxes, canvasW, canvasH, regions: [], nextBestNodeId, criticalPath }
}
