// Single definition of "dependency" semantics for the course graph.
//
// Only a hard prerequisite edge means "you must understand the source node
// before the target." A `sequence` edge records upload/study ORDER (useful for
// navigation and the source-mode default reading order) but is NOT a
// dependency — treating it as one inflated the vulnerability cascade, gated
// unlock-readiness on mere ordering, and made the critical-path highlight light
// up the entire upstream ancestry instead of the exact blocking chain. Every
// consumer that needs to answer "does X depend on Y" goes through this module
// instead of re-deciding which edge types count.

export type DependencyEdgeLike = {
  from: string
  to: string
  edgeType: string
  prereqStrength?: 'hard' | 'soft' | null
}

/** True only for a hard prerequisite edge — the sole "must learn before" relationship. */
export function isHardPrerequisite(edge: DependencyEdgeLike): boolean {
  return edge.edgeType === 'prerequisite' && edge.prereqStrength !== 'soft'
}

/** Forward adjacency (from -> [to, ...]) restricted to hard-prerequisite edges. */
export function dependencyAdjacency(
  edges: DependencyEdgeLike[],
  nodeIds: Iterable<string>,
): Map<string, string[]> {
  const adjacency = new Map<string, string[]>()
  for (const id of nodeIds) adjacency.set(id, [])
  for (const edge of edges) {
    if (!isHardPrerequisite(edge)) continue
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, [])
    adjacency.get(edge.from)!.push(edge.to)
  }
  return adjacency
}

/** Reverse adjacency (to -> [from, ...]) restricted to hard-prerequisite edges — "what must be learned before this." */
export function dependencyReverseAdjacency(
  edges: DependencyEdgeLike[],
  nodeIds: Iterable<string>,
): Map<string, string[]> {
  const adjacency = new Map<string, string[]>()
  for (const id of nodeIds) adjacency.set(id, [])
  for (const edge of edges) {
    if (!isHardPrerequisite(edge)) continue
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, [])
    adjacency.get(edge.to)!.push(edge.from)
  }
  return adjacency
}

/**
 * The exact chain still blocking `targetId`: walk backward through hard
 * prerequisites only, and stop expanding past any prerequisite that is already
 * satisfied (`isSatisfied` returns true) — a completed prerequisite is the
 * boundary of "what's left to do," not a reason to keep climbing the whole
 * ancestry. The satisfied boundary node itself is included (as context for
 * where progress currently stands) but nothing upstream of it is.
 */
export function requiredUnmetPath(params: {
  targetId: string
  edges: DependencyEdgeLike[]
  isSatisfied: (nodeId: string) => boolean
}): { nodes: Set<string>; edges: Set<string> } {
  const { targetId, edges, isSatisfied } = params
  const reverseAdjacency = new Map<string, Array<{ from: string; key: string }>>()
  for (const edge of edges) {
    if (!isHardPrerequisite(edge)) continue
    if (!reverseAdjacency.has(edge.to)) reverseAdjacency.set(edge.to, [])
    reverseAdjacency.get(edge.to)!.push({ from: edge.from, key: `${edge.from}::${edge.to}` })
  }

  const nodes = new Set<string>([targetId])
  const edgeKeys = new Set<string>()
  const visited = new Set<string>([targetId])
  const queue: string[] = [targetId]

  while (queue.length) {
    const current = queue.shift()!
    for (const { from, key } of reverseAdjacency.get(current) ?? []) {
      edgeKeys.add(key)
      nodes.add(from)
      if (isSatisfied(from) || visited.has(from)) continue
      visited.add(from)
      queue.push(from)
    }
  }

  return { nodes, edges: edgeKeys }
}

/**
 * Longest hard-prerequisite chain across the whole graph — the learning spine.
 * Longest-path DP over the hard-prereq DAG in topological order. Returns the
 * ordered node ids of the backbone; empty when there are no hard prereqs.
 */
export function longestDependencyPath(
  nodeIds: string[],
  edges: DependencyEdgeLike[],
): string[] {
  const adjacency = dependencyAdjacency(edges, nodeIds)
  const indegree = new Map<string, number>()
  for (const id of nodeIds) indegree.set(id, 0)
  for (const [, targets] of adjacency) {
    for (const to of targets) indegree.set(to, (indegree.get(to) ?? 0) + 1)
  }

  const longestEndingAt = new Map<string, number>()
  const parent = new Map<string, string | null>()
  const queue: string[] = []
  for (const id of nodeIds) {
    longestEndingAt.set(id, 0)
    parent.set(id, null)
    if ((indegree.get(id) ?? 0) === 0) queue.push(id)
  }

  const seen = new Set<string>()
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    for (const to of adjacency.get(id) ?? []) {
      if ((longestEndingAt.get(id)! + 1) > (longestEndingAt.get(to) ?? 0)) {
        longestEndingAt.set(to, longestEndingAt.get(id)! + 1)
        parent.set(to, id)
      }
      indegree.set(to, (indegree.get(to) ?? 1) - 1)
      if ((indegree.get(to) ?? 0) === 0) queue.push(to)
    }
  }

  let endId: string | null = null
  let best = 0
  for (const [id, length] of longestEndingAt) {
    if (length > best) { best = length; endId = id }
  }
  if (!endId || best === 0) return []

  const path: string[] = []
  let cursor: string | null = endId
  while (cursor) {
    path.unshift(cursor)
    cursor = parent.get(cursor) ?? null
  }
  return path
}
