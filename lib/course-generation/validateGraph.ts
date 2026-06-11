// ── Graph validation & repair ────────────────────────────────────────────────
//
// The AI generates the curriculum tree + candidate prerequisite/cross edges. It
// is good at LOCAL judgments ("what does this topic directly need?") and bad at
// GLOBAL topology (it hallucinates edges, over-links, builds false sibling
// chains, and creates cycles). This module is the deterministic "code owns the
// global structure" half: it treats AI edges as candidates and guarantees the
// stored prerequisite graph is structurally sound, whatever the model emitted.
//
// Every check maps to a real hallucination failure mode (see ValidationReport).
// Repairs are conservative: demote-to-soft where the relationship might be real
// but must not constrain layout; drop only when the edge is invalid or redundant.

export type PrereqStrength = 'hard' | 'soft'

export interface ValidatorTopic {
  id: string
  parentId: string | null
  branchId: string
  sequenceIndex: number
  prerequisites: string[]
  /** prereqId → strength, as emitted by the AI. Missing entries default to hard. */
  prerequisiteStrength: Record<string, string>
}

export interface ValidatorEdge {
  fromId: string
  toId: string
  type: string
}

export interface ValidationReport {
  droppedReferences: number   // edges to ids that don't exist
  selfLoops: number           // X → X
  duplicates: number          // repeated edges
  cyclesBroken: number        // back-edges demoted to make the hard DAG acyclic
  transitiveRemoved: number   // redundant hard edges implied by a longer path
  siblingChainsDemoted: number// hard deps between peers under the same parent
  fanInDemoted: number        // excess hard prerequisites beyond the cap
  crossBranchDemoted: number  // excess cross-branch hard prerequisites
  orphans: string[]           // teachable nodes with no relationship at all
  notes: string[]
}

export interface ValidatedGraph {
  /** topicId → cleaned prerequisites + strengths (hard first, then soft). */
  topics: Map<string, { prerequisites: string[]; prerequisiteStrength: Record<string, PrereqStrength> }>
  structuralEdges: ValidatorEdge[]
  report: ValidationReport
}

export interface ValidateOptions {
  maxHardFanIn?: number        // max direct hard prerequisites per topic
  maxCrossBranchHard?: number  // max hard prerequisites crossing branch families
}

export function validateGraph(
  topics: ValidatorTopic[],
  structuralEdges: ValidatorEdge[],
  opts: ValidateOptions = {},
): ValidatedGraph {
  const maxHardFanIn = opts.maxHardFanIn ?? 6
  const maxCrossBranchHard = opts.maxCrossBranchHard ?? 8

  const report: ValidationReport = {
    droppedReferences: 0, selfLoops: 0, duplicates: 0, cyclesBroken: 0,
    transitiveRemoved: 0, siblingChainsDemoted: 0, fanInDemoted: 0,
    crossBranchDemoted: 0, orphans: [], notes: [],
  }

  const idSet = new Set(topics.map((t) => t.id))
  const parentOf = new Map(topics.map((t) => [t.id, t.parentId]))
  const branchOf = new Map(topics.map((t) => [t.id, t.branchId]))
  const seqOf = new Map(topics.map((t) => [t.id, t.sequenceIndex]))

  // Per-topic prerequisite sets, split by strength. These are the mutable
  // working state; every repair moves ids between them or removes them.
  const hard = new Map<string, Set<string>>()
  const soft = new Map<string, Set<string>>()
  for (const t of topics) { hard.set(t.id, new Set()); soft.set(t.id, new Set()) }

  // ── Normalize: referential integrity, self-loops, duplicates ──
  for (const t of topics) {
    const seen = new Set<string>()
    for (const p of t.prerequisites ?? []) {
      const pid = String(p)
      if (pid === t.id) { report.selfLoops++; continue }
      if (!idSet.has(pid)) { report.droppedReferences++; continue }
      if (seen.has(pid)) { report.duplicates++; continue }
      seen.add(pid)
      const k: PrereqStrength = t.prerequisiteStrength?.[pid] === 'soft' ? 'soft' : 'hard'
      ;(k === 'hard' ? hard : soft).get(t.id)!.add(pid)
    }
  }

  const demote = (topicId: string, prereqId: string) => {
    if (hard.get(topicId)!.delete(prereqId)) soft.get(topicId)!.add(prereqId)
  }

  // ── (1) Sibling false-chain: peers under the same parent must not hard-depend
  //        on each other (the classic linked-list hallucination). Demote to soft. ──
  for (const t of topics) {
    const tp = parentOf.get(t.id)
    if (!tp) continue
    for (const p of [...hard.get(t.id)!]) {
      if (parentOf.get(p) && parentOf.get(p) === tp) {
        demote(t.id, p)
        report.siblingChainsDemoted++
      }
    }
  }

  // ── (2) Cross-branch budget: a few cross-family hard prereqs are meaningful
  //        (convergence); many are over-linking. Keep the earliest, demote rest. ──
  const crossEdges: Array<{ from: string; to: string }> = []
  for (const t of topics) {
    for (const p of hard.get(t.id)!) {
      if (branchOf.get(p) !== branchOf.get(t.id)) crossEdges.push({ from: p, to: t.id })
    }
  }
  if (crossEdges.length > maxCrossBranchHard) {
    crossEdges.sort((a, b) => (seqOf.get(a.to) ?? 0) - (seqOf.get(b.to) ?? 0))
    for (const e of crossEdges.slice(maxCrossBranchHard)) {
      demote(e.to, e.from)
      report.crossBranchDemoted++
    }
  }

  // ── (3) Fan-in cap: keep the most proximate hard prereqs (closest in sequence),
  //        demote the rest — a node needing 12 hard prereqs is almost always noise. ──
  for (const t of topics) {
    const hp = [...hard.get(t.id)!]
    if (hp.length > maxHardFanIn) {
      const ts = seqOf.get(t.id) ?? 0
      hp.sort((a, b) => Math.abs((seqOf.get(a) ?? 0) - ts) - Math.abs((seqOf.get(b) ?? 0) - ts))
      for (const p of hp.slice(maxHardFanIn)) {
        demote(t.id, p)
        report.fanInDemoted++
      }
    }
  }

  const buildSucc = () => {
    const succ = new Map<string, string[]>()
    for (const t of topics) succ.set(t.id, [])
    for (const t of topics) for (const p of hard.get(t.id)!) succ.get(p)!.push(t.id)
    return succ
  }

  // ── (4) Cycle breaking: a learning DAG must be acyclic. Find a back-edge via
  //        DFS and demote it to soft; repeat until acyclic (bounded). ──
  let guard = topics.length * 4 + 8
  while (guard-- > 0) {
    const succ = buildSucc()
    const color = new Map<string, 0 | 1 | 2>() // 0 unvisited, 1 on-stack, 2 done
    for (const t of topics) color.set(t.id, 0)
    let backEdge: { from: string; to: string } | null = null

    for (const start of topics) {
      if (color.get(start.id) !== 0) continue
      const stack: Array<{ node: string; it: number }> = [{ node: start.id, it: 0 }]
      color.set(start.id, 1)
      while (stack.length) {
        const top = stack[stack.length - 1]
        const kids = succ.get(top.node)!
        if (top.it < kids.length) {
          const nx = kids[top.it++]
          const c = color.get(nx)
          if (c === 1) { backEdge = { from: top.node, to: nx }; break }
          if (c === 0) { color.set(nx, 1); stack.push({ node: nx, it: 0 }) }
        } else {
          color.set(top.node, 2)
          stack.pop()
        }
      }
      if (backEdge) break
    }

    if (!backEdge) break
    // back-edge from→to means: prereq `from` for topic `to` closes a cycle.
    demote(backEdge.to, backEdge.from)
    report.cyclesBroken++
  }

  // ── (5) Transitive reduction: drop hard edge a→c when a longer hard path a⇒c
  //        already exists. Decided against the (now acyclic) graph snapshot, so
  //        reachability is preserved. ──
  const succ = buildSucc()
  for (const a of topics) {
    for (const c of [...succ.get(a.id)!]) {
      const stack = succ.get(a.id)!.filter((x) => x !== c)
      const seen = new Set<string>()
      let found = false
      while (stack.length) {
        const cur = stack.pop()!
        if (cur === c) { found = true; break }
        if (seen.has(cur)) continue
        seen.add(cur)
        for (const n of succ.get(cur)!) stack.push(n)
      }
      if (found) {
        hard.get(c)!.delete(a.id) // redundant hard prereq → drop entirely
        report.transitiveRemoved++
      }
    }
  }

  // ── (6) Orphans (report only) ──
  const isPrereqOfSomeone = new Set<string>()
  for (const t of topics) {
    for (const p of hard.get(t.id)!) isPrereqOfSomeone.add(p)
    for (const p of soft.get(t.id)!) isPrereqOfSomeone.add(p)
  }
  for (const t of topics) {
    const degree = hard.get(t.id)!.size + soft.get(t.id)!.size
    if (degree === 0 && !isPrereqOfSomeone.has(t.id)) report.orphans.push(t.id)
  }

  // ── Rebuild cleaned per-topic prerequisites ──
  const outTopics = new Map<string, { prerequisites: string[]; prerequisiteStrength: Record<string, PrereqStrength> }>()
  for (const t of topics) {
    const h = [...hard.get(t.id)!]
    const s = [...soft.get(t.id)!]
    const strength: Record<string, PrereqStrength> = {}
    for (const p of h) strength[p] = 'hard'
    for (const p of s) strength[p] = 'soft'
    outTopics.set(t.id, { prerequisites: [...h, ...s], prerequisiteStrength: strength })
  }

  // ── Clean structural edges (referential integrity + dedup) ──
  const seenEdge = new Set<string>()
  const cleanEdges: ValidatorEdge[] = []
  for (const e of structuralEdges) {
    if (!idSet.has(e.fromId) || !idSet.has(e.toId) || e.fromId === e.toId) {
      report.droppedReferences++
      continue
    }
    const key = `${e.fromId}::${e.toId}::${e.type}`
    if (seenEdge.has(key)) { report.duplicates++; continue }
    seenEdge.add(key)
    cleanEdges.push(e)
  }

  if (report.orphans.length) {
    report.notes.push(`${report.orphans.length} topic(s) have no prerequisite relationships.`)
  }

  return { topics: outTopics, structuralEdges: cleanEdges, report }
}
