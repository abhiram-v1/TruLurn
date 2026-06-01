// Compute x/y positions for graph nodes using a longest-path layering algorithm.
// Nodes with no incoming edges start at layer 0.
// Each subsequent layer is separated by COL_W px; nodes within a layer are
// sorted by branch then position and separated by ROW_H px.

const COL_W = 282   // horizontal gap between layers (columns)
const ROW_H = 126   // vertical gap between nodes in the same column
const START_X = 60
const START_Y = 60
const NODE_W = 216  // default node card width

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

/** Assign a "layer" (column index) to each node via Kahn's topological sort.
 *  Each node's layer = max(layer of predecessors) + 1.
 *  Cycles are handled gracefully — cyclic nodes get layer 0. */
function assignLayers(nodes: RawNode[], edges: RawEdge[]): Map<string, number> {
  const inDegree = new Map<string, number>()
  const succ = new Map<string, string[]>()   // forward adjacency
  const bestPred = new Map<string, number>() // id → max layer of known predecessors

  for (const n of nodes) {
    inDegree.set(n.id, 0)
    succ.set(n.id, [])
  }

  for (const e of edges) {
    if (!succ.has(e.from) || !succ.has(e.to)) continue
    succ.get(e.from)!.push(e.to)
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1)
  }

  // Kahn's BFS
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
      const remaining = (inDegree.get(next) ?? 1) - 1
      inDegree.set(next, remaining)
      if (remaining === 0) queue.push(next)
    }
  }

  // Nodes not reached (isolated / in cycles) → layer 0
  for (const n of nodes) {
    if (!layer.has(n.id)) layer.set(n.id, 0)
  }

  return layer
}

/** Compute x/y/w for every node and return canvas dimensions. */
export function computeLayout(
  nodes: RawNode[],
  edges: RawEdge[],
): {
  positions: Map<string, NodePosition>
  canvasW: number
  canvasH: number
} {
  const layers = assignLayers(nodes, edges)

  // Group nodes by layer
  const byLayer = new Map<number, RawNode[]>()
  for (const n of nodes) {
    const l = layers.get(n.id) ?? 0
    if (!byLayer.has(l)) byLayer.set(l, [])
    byLayer.get(l)!.push(n)
  }

  const positions = new Map<string, NodePosition>()
  let maxLayer = 0
  let maxColSize = 0

  for (const [l, group] of byLayer) {
    // Within each column: sort by branch then position for visual grouping
    group.sort((a, b) =>
      a.branch_id.localeCompare(b.branch_id) || a.position - b.position,
    )

    group.forEach((n, i) => {
      positions.set(n.id, {
        x: START_X + l * COL_W,
        y: START_Y + i * ROW_H,
        w: NODE_W,
      })
    })

    if (l > maxLayer) maxLayer = l
    if (group.length > maxColSize) maxColSize = group.length
  }

  const canvasW = Math.max(1900, START_X + (maxLayer + 1) * COL_W + 260)
  const canvasH = Math.max(980, START_Y + maxColSize * ROW_H + 100)

  return { positions, canvasW, canvasH }
}
