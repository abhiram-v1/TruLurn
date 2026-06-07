// Branch-lane layout engine.
//
// Each branch is assigned a horizontal swim lane (a y-band across the full canvas).
// Within each lane, nodes are placed left-to-right by their DAG layer (topological
// distance from the nearest source). Multiple nodes in the same lane+layer are
// stacked vertically within that lane.
//
// Effect:
//   - Concepts from the same branch cluster together in a band
//   - Cross-branch prerequisite edges are diagonal, not horizontal
//   - The result looks like a knowledge network, not a linked list
//
// Compare to the old "one pool of columns" approach where every node shared the
// same column x regardless of branch — that always produced a chain appearance.

const COL_W     = 300   // horizontal pitch between DAG layers (px)
const SLOT_H    = 112   // vertical space per node slot inside a lane
const LANE_VPAD = 44    // top + bottom padding inside each lane
const LANE_GAP  = 32    // gap between adjacent swim lanes
const START_X   = 80
const START_Y   = 60
export const NODE_W = 196   // node card width

interface RawNode {
  id: string
  branch_id: string
  position: number
}

interface RawEdge {
  from: string
  to: string
}

interface NodePosition {
  x: number
  y: number
  w: number
}

export interface GraphRegion {
  id: string        // branch_id (raw)
  label: string     // filled in by transform.ts with the real branch title
  x: number
  y: number
  w: number
  h: number
}

// ── Topological layer assignment ─────────────────────────────────────────────
// Each node's layer = longest path from any source node to it.
// Cycles are handled gracefully — cyclic nodes land at layer 0.
function assignLayers(nodes: RawNode[], edges: RawEdge[]): Map<string, number> {
  const inDegree = new Map<string, number>()
  const succ     = new Map<string, string[]>()
  const bestPred = new Map<string, number>()

  for (const n of nodes) {
    inDegree.set(n.id, 0)
    succ.set(n.id, [])
  }
  for (const e of edges) {
    if (!succ.has(e.from) || !succ.has(e.to)) continue
    succ.get(e.from)!.push(e.to)
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1)
  }

  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }

  const layer = new Map<string, number>()
  while (queue.length > 0) {
    const id = queue.shift()!
    const myLayer = bestPred.get(id) ?? 0
    layer.set(id, myLayer)
    for (const next of succ.get(id) ?? []) {
      const candidate = myLayer + 1
      if (!bestPred.has(next) || bestPred.get(next)! < candidate) {
        bestPred.set(next, candidate)
      }
      const rem = (inDegree.get(next) ?? 1) - 1
      inDegree.set(next, rem)
      if (rem === 0) queue.push(next)
    }
  }

  // Nodes not reached (isolated or in cycles) → layer 0
  for (const n of nodes) {
    if (!layer.has(n.id)) layer.set(n.id, 0)
  }

  return layer
}

// ── Main layout ───────────────────────────────────────────────────────────────
export function computeLayout(
  nodes: RawNode[],
  edges: RawEdge[],
): {
  positions: Map<string, NodePosition>
  canvasW: number
  canvasH: number
  regions: GraphRegion[]
} {
  if (!nodes.length) {
    return { positions: new Map(), canvasW: 1200, canvasH: 800, regions: [] }
  }

  const layers = assignLayers(nodes, edges)

  // ── Determine branch order ──────────────────────────────────────────────
  // Branches appear in the order they first show up by position (study order).
  const branchOrder: string[] = []
  const seenBranches = new Set<string>()
  const byPosition = [...nodes].sort((a, b) => a.position - b.position)
  for (const n of byPosition) {
    if (!seenBranches.has(n.branch_id)) {
      branchOrder.push(n.branch_id)
      seenBranches.add(n.branch_id)
    }
  }

  // ── Group nodes by branch → layer, sorted by position within each layer ──
  const laneLayerNodes = new Map<string, Map<number, RawNode[]>>()
  for (const bid of branchOrder) laneLayerNodes.set(bid, new Map())
  for (const n of nodes) {
    const l = layers.get(n.id) ?? 0
    const m = laneLayerNodes.get(n.branch_id)!
    if (!m.has(l)) m.set(l, [])
    m.get(l)!.push(n)
  }
  for (const m of laneLayerNodes.values()) {
    for (const arr of m.values()) arr.sort((a, b) => a.position - b.position)
  }

  // ── Row cap: how many nodes stack vertically before wrapping into a new
  //    column. Derived from the largest single layer so dense lanes wrap into
  //    a roughly square grid instead of one endless vertical column. ──
  let maxLayerNodes = 1
  for (const m of laneLayerNodes.values()) {
    for (const arr of m.values()) maxLayerNodes = Math.max(maxLayerNodes, arr.length)
  }
  const ROW_CAP = Math.min(6, Math.max(3, Math.ceil(Math.sqrt(maxLayerNodes))))

  // ── First pass: assign each node a (col, row) within its lane ──────────
  // For each layer (left→right), nodes wrap top-to-bottom into ROW_CAP rows,
  // spilling into additional sub-columns. The lane's column cursor advances
  // past each layer's block so deeper layers sit further right.
  const gridPos = new Map<string, { col: number; row: number }>()
  const laneCols = new Map<string, number>()
  const laneRows = new Map<string, number>()

  for (const bid of branchOrder) {
    const m = laneLayerNodes.get(bid)!
    const sortedLayers = [...m.keys()].sort((a, b) => a - b)
    let colCursor = 0
    let maxRowsUsed = 1
    for (const l of sortedLayers) {
      const arr = m.get(l)!
      arr.forEach((n, i) => {
        const subCol = Math.floor(i / ROW_CAP)
        const row = i % ROW_CAP
        gridPos.set(n.id, { col: colCursor + subCol, row })
        maxRowsUsed = Math.max(maxRowsUsed, row + 1)
      })
      colCursor += Math.ceil(arr.length / ROW_CAP)
    }
    laneCols.set(bid, Math.max(1, colCursor))
    laneRows.set(bid, maxRowsUsed)
  }

  // ── Assign y offsets to lanes (height driven by rows used) ─────────────
  const laneHeight = (bid: string) =>
    (laneRows.get(bid) ?? 1) * SLOT_H + 2 * LANE_VPAD
  const laneY = new Map<string, number>()
  let currentY = START_Y
  for (const bid of branchOrder) {
    laneY.set(bid, currentY)
    currentY += laneHeight(bid) + LANE_GAP
  }

  // ── Second pass: convert (col, row) → pixel x/y ───────────────────────
  const positions = new Map<string, NodePosition>()
  for (const n of nodes) {
    const g = gridPos.get(n.id) ?? { col: 0, row: 0 }
    const baseY = laneY.get(n.branch_id) ?? START_Y
    positions.set(n.id, {
      x: START_X + g.col * COL_W,
      y: baseY + LANE_VPAD + g.row * SLOT_H,
      w: NODE_W,
    })
  }

  // ── Canvas dimensions ──────────────────────────────────────────────────
  const maxCols = Math.max(1, ...laneCols.values())
  const canvasW = Math.max(1600, START_X + maxCols * COL_W + 200)
  const canvasH = Math.max(900, currentY + 60)

  // ── Region bands (one per branch, spanning full canvas width) ─────────
  const regions: GraphRegion[] = branchOrder.map((bid) => ({
    id: bid,
    label: bid,
    x: 16,
    y: (laneY.get(bid) ?? 0) - 10,
    w: canvasW - 32,
    h: laneHeight(bid) + 20,
  }))

  return { positions, canvasW, canvasH, regions }
}
