// Left-to-right learning-journey layout of compact branch boxes.
//
// Branch boxes themselves are ordered horizontally: the box(es) holding the
// beginning of the course sit left, and each box that depends on another
// (cross-branch hard prerequisite) sits strictly to its right. Branches with
// no dependency between them share a column — visually parallel, stacked
// vertically. Inside each box, leaves flow left-to-right through local stages
// driven by intra-branch sequence + hard prerequisites.

import type { GraphBox } from './types'

export const CARD_W = 208
const CARD_GAP_Y = 12
const STAGE_GAP_X = 82
const STAGE_PITCH = CARD_W + STAGE_GAP_X
export const GROUP_PAD_X = 24
export const GROUP_HEADER_H = 42
export const GROUP_PAD_BOTTOM = 24
export const GROUP_GAP_Y = 34
const COLUMN_GAP_X = 130
const MARGIN_X = 72
const MARGIN_Y = 44
const MIN_CANVAS_W = 1200
const MIN_CANVAS_H = 760
// Per-branch internal staging — small boxes, a few cards per column.
const TARGET_NODES_PER_STAGE = 3
const MAX_BRANCH_STAGES = 6
// Soft cap before parallel branches overflow into the next column.
const MAX_BRANCHES_PER_COLUMN = 3

export function cardHeight(importance: number): number {
  if (importance >= 3) return 96
  if (importance === 2) return 86
  return 76
}

export type NodeRole = 'spine' | 'box' | 'branch'

export interface RawNode {
  id: string
  branch_id: string
  parent_id: string | null
  node_type: string
  children_count: number
  depth_level: number
  sequence_index: number
  position: number
  importance: 1 | 2 | 3
  title: string
  section?: string
  spine_candidate?: boolean
  spine_level?: number
}

export interface RawEdge {
  from: string
  to: string
  edgeType: string
  prereqStrength?: 'hard' | 'soft' | null
}

export interface NodeLayout {
  x: number
  y: number
  w: number
  h: number
  role: NodeRole
  spineLevel: number
  layer: number
  boxId: string | null
  positionInBox: number | null
}

export interface LayoutResult {
  positions: Map<string, NodeLayout>
  boxes: GraphBox[]
  canvasW: number
  canvasH: number
}

function isContainer(node: RawNode): boolean {
  return node.node_type === 'container' || node.children_count > 0
}

// Local stage (horizontal position inside a branch box) for every leaf.
//
// stage(n) = max( sequenceBaseline(n), max over hard-prereq p of stage(p) + 1 )
//
// Two independent meanings combine cleanly, instead of being conflated:
//   • sequenceBaseline spreads otherwise-independent concepts across the box
//     so it reads as a small timeline rather than one tall first column.
//   • the hard-prerequisite term guarantees a concept always sits strictly to the
//     right of everything it truly depends on (a real longest-path layering).
//
// Computed in topological order so every prerequisite's stage is final before its
// dependents are visited. Soft prerequisites never constrain position. Cyclic
// prerequisites (invalid, but defensive) fall back to the sequence baseline.
function computeStages(leaves: RawNode[], edges: RawEdge[]) {
  const byId = new Map(leaves.map((leaf) => [leaf.id, leaf]))
  const ordered = [...leaves].sort(
    (a, b) => a.sequence_index - b.sequence_index || a.position - b.position,
  )
  const total = ordered.length
  const sequenceStages = Math.max(
    1,
    Math.min(MAX_BRANCH_STAGES, Math.ceil(total / TARGET_NODES_PER_STAGE)),
  )

  // Sequence baseline — percentile of the node's position in study order.
  const seqStage = new Map<string, number>()
  ordered.forEach((leaf, index) => {
    const s = total <= 1 ? 0 : Math.floor((index / total) * sequenceStages)
    seqStage.set(leaf.id, Math.min(sequenceStages - 1, s))
  })

  // Hard-prerequisite DAG.
  const outgoing = new Map<string, string[]>()
  const indegree = new Map<string, number>()
  leaves.forEach((leaf) => {
    outgoing.set(leaf.id, [])
    indegree.set(leaf.id, 0)
  })
  const seenEdge = new Set<string>()
  for (const edge of edges) {
    if (
      edge.edgeType !== 'prerequisite'
      || edge.prereqStrength === 'soft'
      || !byId.has(edge.from)
      || !byId.has(edge.to)
      || edge.from === edge.to
    ) continue
    const key = `${edge.from}->${edge.to}`
    if (seenEdge.has(key)) continue
    seenEdge.add(key)
    outgoing.get(edge.from)!.push(edge.to)
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1)
  }

  // Topological relaxation. Roots start at their sequence baseline; each edge
  // raises its target to at least (source stage + 1).
  const stage = new Map<string, number>()
  const queue = ordered
    .filter((leaf) => (indegree.get(leaf.id) ?? 0) === 0)
    .map((leaf) => leaf.id)
  const processed = new Set<string>()

  while (queue.length) {
    queue.sort((a, b) => (byId.get(a)?.sequence_index ?? 0) - (byId.get(b)?.sequence_index ?? 0))
    const id = queue.shift()!
    if (processed.has(id)) continue
    processed.add(id)
    if (!stage.has(id)) stage.set(id, seqStage.get(id) ?? 0)
    const current = stage.get(id)!
    for (const target of outgoing.get(id) ?? []) {
      const next = Math.max(seqStage.get(target) ?? 0, current + 1, stage.get(target) ?? 0)
      stage.set(target, next)
      indegree.set(target, (indegree.get(target) ?? 1) - 1)
      if ((indegree.get(target) ?? 0) === 0) queue.push(target)
    }
  }

  // Any leaf left unranked (cycle) keeps its sequence baseline.
  for (const leaf of leaves) {
    if (!stage.has(leaf.id)) stage.set(leaf.id, seqStage.get(leaf.id) ?? 0)
  }

  return stage
}

// Column (macro horizontal position) for every branch box.
//
// col(b) = max( baseline(b), max over prereq-branch p of col(p) + 1 )
//
//   • baseline: the branch that opens the course (earliest sequence) anchors
//     column 0; every other branch starts at column 1 so "beginning topics"
//     visibly leads the journey even without cross-branch edges.
//   • cross-branch HARD prerequisites push dependents strictly right, exactly
//     like leaf staging but at branch granularity.
//
// Branches that end up in the same column are parallel — independent of each
// other — and stack vertically. Oversized columns overflow rightward (always
// safe: moving right never violates a prerequisite).
function computeBranchColumns(
  branchIds: string[],
  branchLeaves: Map<string, RawNode[]>,
  edges: RawEdge[],
): Map<string, number> {
  const leafBranch = new Map<string, string>()
  const minSeq = new Map<string, number>()
  for (const branchId of branchIds) {
    let min = Number.MAX_SAFE_INTEGER
    for (const leaf of branchLeaves.get(branchId) ?? []) {
      leafBranch.set(leaf.id, branchId)
      if (leaf.sequence_index < min) min = leaf.sequence_index
    }
    minSeq.set(branchId, min)
  }
  const seqOrder = [...branchIds].sort(
    (a, b) => (minSeq.get(a) ?? 0) - (minSeq.get(b) ?? 0),
  )

  // Cross-branch hard prerequisite DAG.
  const outgoing = new Map<string, Set<string>>()
  const indegree = new Map<string, number>()
  branchIds.forEach((branchId) => {
    outgoing.set(branchId, new Set())
    indegree.set(branchId, 0)
  })
  for (const edge of edges) {
    if (edge.edgeType !== 'prerequisite' || edge.prereqStrength === 'soft') continue
    const fromBranch = leafBranch.get(edge.from)
    const toBranch = leafBranch.get(edge.to)
    if (!fromBranch || !toBranch || fromBranch === toBranch) continue
    if (outgoing.get(fromBranch)!.has(toBranch)) continue
    outgoing.get(fromBranch)!.add(toBranch)
    indegree.set(toBranch, (indegree.get(toBranch) ?? 0) + 1)
  }

  const baseline = (branchId: string) => (branchId === seqOrder[0] ? 0 : 1)
  const col = new Map<string, number>()
  const queue = seqOrder.filter((branchId) => (indegree.get(branchId) ?? 0) === 0)
  const processed = new Set<string>()
  while (queue.length) {
    queue.sort((a, b) => (minSeq.get(a) ?? 0) - (minSeq.get(b) ?? 0))
    const id = queue.shift()!
    if (processed.has(id)) continue
    processed.add(id)
    if (!col.has(id)) col.set(id, baseline(id))
    const current = col.get(id)!
    for (const target of outgoing.get(id) ?? []) {
      col.set(target, Math.max(baseline(target), current + 1, col.get(target) ?? 0))
      indegree.set(target, (indegree.get(target) ?? 1) - 1)
      if ((indegree.get(target) ?? 0) === 0) queue.push(target)
    }
  }
  // Cyclic cross-branch edges (invalid, defensive) fall back to baseline.
  for (const branchId of branchIds) {
    if (!col.has(branchId)) col.set(branchId, baseline(branchId))
  }

  // Overflow crowded columns rightward, later-sequence branches first.
  for (let c = 0; ; c += 1) {
    const inColumn = seqOrder.filter((branchId) => col.get(branchId) === c)
    if (inColumn.length === 0 && c > Math.max(...col.values())) break
    for (const branchId of inColumn.slice(MAX_BRANCHES_PER_COLUMN)) {
      col.set(branchId, c + 1)
    }
  }

  return col
}

interface BranchLayout {
  branchId: string
  stageLeaves: Map<number, RawNode[]>
  w: number
  h: number
  contentH: number
}

// Compact internal layout of one branch box: local stages from the branch's own
// sequence + hard prerequisites, sized to fit its content exactly.
function measureBranch(branchId: string, leaves: RawNode[], edges: RawEdge[]): BranchLayout {
  const stages = computeStages(leaves, edges)
  const stageLeaves = new Map<number, RawNode[]>()
  ;[...leaves]
    .sort((a, b) => a.sequence_index - b.sequence_index || a.position - b.position)
    .forEach((leaf) => {
      const stage = stages.get(leaf.id) ?? 0
      if (!stageLeaves.has(stage)) stageLeaves.set(stage, [])
      stageLeaves.get(stage)!.push(leaf)
    })

  const stageCount = Math.max(...stageLeaves.keys()) + 1
  let contentH = 0
  for (const stageNodes of stageLeaves.values()) {
    const stackH = stageNodes.reduce(
      (sum, node) => sum + cardHeight(node.importance) + CARD_GAP_Y, -CARD_GAP_Y,
    )
    if (stackH > contentH) contentH = stackH
  }

  return {
    branchId,
    stageLeaves,
    w: stageCount * STAGE_PITCH - STAGE_GAP_X + GROUP_PAD_X * 2,
    h: GROUP_HEADER_H + contentH + GROUP_PAD_BOTTOM,
    contentH,
  }
}

export function computeLayout(
  nodes: RawNode[],
  branchTitles: Map<string, string>,
  edges: RawEdge[] = [],
): LayoutResult {
  if (!nodes.length) {
    return { positions: new Map(), boxes: [], canvasW: MIN_CANVAS_W, canvasH: MIN_CANVAS_H }
  }

  const leaves = nodes.filter((node) => !isContainer(node))
  const branchLeaves = new Map<string, RawNode[]>()
  for (const leaf of leaves) {
    if (!branchLeaves.has(leaf.branch_id)) branchLeaves.set(leaf.branch_id, [])
    branchLeaves.get(leaf.branch_id)!.push(leaf)
  }

  const branchIds = [
    ...Array.from(branchTitles.keys()).filter((branchId) => branchLeaves.has(branchId)),
    ...Array.from(branchLeaves.keys()).filter((branchId) => !branchTitles.has(branchId)),
  ]
  const ramps = ['teal', 'blue', 'amber', 'green', 'purple', 'coral']
  const rampOf = new Map(branchIds.map((branchId, i) => [branchId, ramps[i % ramps.length]]))

  const columns = computeBranchColumns(branchIds, branchLeaves, edges)
  const measured = new Map(
    branchIds.map((branchId) => [
      branchId,
      measureBranch(branchId, branchLeaves.get(branchId) ?? [], edges),
    ]),
  )

  // Group branches per column, ordered by sequence within the column.
  const minSeq = (branchId: string) =>
    Math.min(...(branchLeaves.get(branchId) ?? []).map((leaf) => leaf.sequence_index))
  const columnCount = Math.max(...columns.values()) + 1
  const columnBranches: string[][] = Array.from({ length: columnCount }, () => [])
  for (const branchId of branchIds) columnBranches[columns.get(branchId)!].push(branchId)
  columnBranches.forEach((ids) => ids.sort((a, b) => minSeq(a) - minSeq(b)))

  const columnW = columnBranches.map((ids) =>
    ids.length ? Math.max(...ids.map((id) => measured.get(id)!.w)) : 0,
  )
  const columnH = columnBranches.map((ids) =>
    ids.reduce((sum, id) => sum + measured.get(id)!.h + GROUP_GAP_Y, -GROUP_GAP_Y),
  )
  const maxColumnH = Math.max(0, ...columnH)

  const positions = new Map<string, NodeLayout>()
  const boxes: GraphBox[] = []
  let columnX = MARGIN_X

  columnBranches.forEach((ids, columnIndex) => {
    if (!ids.length) return
    // Parallel branches stack vertically, the whole stack centred on the row.
    let boxY = MARGIN_Y + Math.max(0, (maxColumnH - columnH[columnIndex]) / 2)

    for (const branchId of ids) {
      const branch = measured.get(branchId)!
      const boxX = columnX + (columnW[columnIndex] - branch.w) / 2
      const groupId = `__branch_group__${branchId}`

      for (const [stage, stageNodes] of branch.stageLeaves) {
        const stackH = stageNodes.reduce(
          (sum, node) => sum + cardHeight(node.importance) + CARD_GAP_Y, -CARD_GAP_Y,
        )
        let nodeY = boxY + GROUP_HEADER_H + Math.max(0, (branch.contentH - stackH) / 2)
        stageNodes.forEach((node, index) => {
          positions.set(node.id, {
            x: boxX + GROUP_PAD_X + stage * STAGE_PITCH,
            y: nodeY,
            w: CARD_W,
            h: cardHeight(node.importance),
            role: 'branch',
            spineLevel: node.spine_level ?? 0,
            layer: columnIndex,
            boxId: groupId,
            positionInBox: index,
          })
          nodeY += cardHeight(node.importance) + CARD_GAP_Y
        })
      }

      boxes.push({
        id: groupId,
        label: branchTitles.get(branchId) ?? branchId,
        family: branchId,
        colourRamp: rampOf.get(branchId)!,
        x: boxX,
        y: boxY,
        w: branch.w,
        h: branch.h,
        layer: columnIndex,
        nodeCount: (branchLeaves.get(branchId) ?? []).length,
        padding: GROUP_PAD_X,
      })

      boxY += branch.h + GROUP_GAP_Y
    }

    columnX += columnW[columnIndex] + COLUMN_GAP_X
  })

  return {
    positions,
    boxes,
    canvasW: Math.max(MIN_CANVAS_W, columnX - COLUMN_GAP_X + MARGIN_X),
    canvasH: Math.max(MIN_CANVAS_H, maxColumnH + MARGIN_Y * 2),
  }
}
