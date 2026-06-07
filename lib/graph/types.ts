// ── Types shared between the graph API, layout engine, and React components ──

export type GraphNodeState =
  | 'mastered'
  | 'functional'
  | 'partial'
  | 'unstable'
  | 'active'
  | 'locked'

export type EdgeStrength = 'weak' | 'medium' | 'strong'

export interface GraphNode {
  id: string
  title: string
  branch: string       // branch_key
  branchTitle: string
  section: string
  x: number
  y: number
  w: number
  importance: 1 | 2 | 3
  state: GraphNodeState
  difficulty: number   // 1–5
  mastery: number      // 0–100
  suggested: boolean
  misconception: boolean
  current: boolean     // the topic the user is actively studying

  // ── Intelligence layer ────────────────────────────────────────────────────
  /** 0–100. Risk inherited from weak prerequisites via cascade. */
  vulnerabilityRisk: number
  /** Number of still-locked downstream nodes reachable from this one. */
  downstreamImpact: number
  /** 0–100. Freshness of last review (100 = recent, 0 = stale). Only meaningful for mastered/functional/partial. */
  decayScore: number
  /** Number of doubt/chat messages logged against this topic. */
  doubtCount: number
  /** True if the last quiz was passed but with false-confidence flags. */
  falseConfidence: boolean
}

export interface GraphEdge {
  from: string
  to: string
  strength: EdgeStrength
  critical: boolean
}

export interface GraphBranch {
  id: string           // branch_key
  title: string
  description: string
  topicCount: number
  mastered: number
  color: string        // css class hint: 'mastered' | 'active' | 'partial' | 'locked'
  active: boolean
}

export interface GraphCourse {
  id: string
  title: string
  topicCount: number
  mastered: number
  functional: number
  partial: number
  unstable: number
  active: number
  locked: number
}

export interface GraphRegion {
  id: string       // branch_id (raw slug)
  label: string    // branch title shown in the background band
  x: number
  y: number
  w: number
  h: number
}

export interface GraphData {
  course: GraphCourse
  branches: GraphBranch[]
  nodes: GraphNode[]
  edges: GraphEdge[]
  canvasW: number
  canvasH: number
  regions: GraphRegion[]
}

// ── What the AI graph evaluator returns ──
export interface GraphNodeUpdate {
  topicId: string
  state?: GraphNodeState
  mastery?: number
  misconception?: boolean
  suggested?: boolean
}

export interface GraphEvaluationResult {
  updates: GraphNodeUpdate[]
  unlocked: string[]
  nextSuggestedTopicId: string | null
  summary: string
}
