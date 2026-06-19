// ── Types shared between the graph API, layout engine, and React components ──

// ── Review / validation states for graph elements ─────────────────────────
export type GraphElementReviewState =
  | 'proposed'
  | 'inferred'
  | 'observed'
  | 'confirmed'
  | 'verified'
  | 'deprecated'
  | 'contradicted'

// ── Multi-dimensional edge score (confidence, recency, frequency, etc.) ────
export interface GraphEdgeScores {
  confidence: number   // 0–100: certainty that relationship exists
  recency: number      // 0–100: 100 = observed very recently
  frequency: number    // 0–100: normalized observation count
  validation: number   // 0–100: cross-evidence validation level
  importance: number   // 0–100: pedagogical significance
  composite: number    // 0–100: weighted aggregate of all scores
  source: string       // 'quiz' | 'doubt' | 'feedback' | 'discussion' | 'inferred'
  updatedAt: string    // ISO date string
}

export type GraphNodeState =
  | 'mastered'
  | 'functional'
  | 'partial'
  | 'unstable'
  | 'active'
  | 'locked'

export type EdgeStrength = 'weak' | 'medium' | 'strong'

/** Recursive-spine node classification (GRAPH_LAYOUT.md v2). */
export type GraphNodeType = 'spine_original' | 'spine_derived' | 'branch'

export interface GraphNode {
  id: string
  title: string
  branch: string       // branch_key
  branchTitle: string
  section: string
  x: number            // card TOP-LEFT x
  y: number            // card TOP-LEFT y
  w: number            // card width
  h: number            // card height
  importance: 1 | 2 | 3

  // ── Recursive-spine layout metadata ────────────────────────────────────────
  nodeType: GraphNodeType   // spine (unboxed landmark) vs branch (inside a box)
  spineLevel: number        // 0 = original spine, 1+ = derived spines
  layer: number             // vertical layer row index
  branchFamily: string      // top-level family id (colour persists across layers)
  colourRamp: string        // 'teal' | 'blue' | 'amber' | 'green' | 'purple' | 'coral'
  boxId: string | null      // branch box this node lives in (null for spine nodes)
  positionInBox: number | null  // vertical index within its box
  isConvergence: boolean    // branch node that is a prereq across >1 branch (promotable)
  teachable: boolean        // opens a lesson and contributes to learning metrics

  // ── AI-emitted pedagogical tags (null → graph fell back to heuristics) ──────
  role: string | null       // 'foundation' | 'mechanism' | 'application' | 'tool' | 'theory'
  importanceTag: 'core' | 'supporting' | null

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
  /** 0–100. Earned knowledge strength: mastery + recall performance + freshness
   *  + user-made connections. Drives node weight in the personal knowledge view. */
  knowledgeStrength: number
  /** Review/validation state derived from observed interactions (optional — absent until graph manager runs). */
  reviewState?: GraphElementReviewState
  /** 0–100. Confidence score from the interaction-based graph manager (optional). */
  confidenceScore?: number
}

export interface GraphEdge {
  from: string
  to: string
  strength: EdgeStrength
  critical: boolean
  edgeType: string  // 'sequence' | 'prerequisite' | 'recommended' | 'semantic' | 'user'
  prereqStrength: 'hard' | 'soft' | null  // for prerequisite edges (AI-tagged)
  /** User connections only: the learner's note on why these concepts link. */
  note?: string | null
  /** User connections only: the userConnections document id (for deletion). */
  connectionId?: string | null
  /** Multi-dimensional relationship scores from the graph manager. */
  scores?: GraphEdgeScores
  /** Review/validation state for this relationship. */
  reviewState?: GraphElementReviewState
}

export interface GraphBranch {
  id: string           // branch_key
  title: string
  description: string
  topicCount: number
  mastered: number
  color: string        // css class hint: 'mastered' | 'active' | 'partial' | 'locked'
  active: boolean
  masteryScore: number // 0–100 weighted mastery for this branch
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
  masteryScore: number   // 0–100 weighted mastery across all nodes
  connectedCount: number // nodes participating in at least one edge
  isolatedCount: number  // nodes with no edges
}

export interface GraphRegion {
  id: string       // branch_id (raw slug)
  label: string    // branch title shown in the background band
  x: number
  y: number
  w: number
  h: number
}

/** An adaptive branch comment box generated from the bounds of its nodes. */
export interface GraphBox {
  id: string          // generated branch group id
  label: string       // branch title shown in the group header
  family: string      // branch family id
  colourRamp: string  // family colour ramp
  x: number
  y: number
  w: number
  h: number
  layer: number
  collapsed?: boolean
  nodeCount?: number
  padding?: number
}

export type GraphViewMode = 'knowledge' | 'reference'

export interface GraphData {
  course: GraphCourse
  branches: GraphBranch[]
  nodes: GraphNode[]
  edges: GraphEdge[]
  boxes: GraphBox[]              // dashed branch-family containers
  canvasW: number
  canvasH: number
  regions: GraphRegion[]         // retained for compatibility (unused in v2)
  nextBestNodeId: string | null  // dynamically computed Next Best Node
  criticalPath: string[]         // ordered node ids of the longest hard-prereq chain (the spine)
  /** Which view produced this data (knowledge = personal graph, reference = full AI map). */
  view?: GraphViewMode
  /** Teachable concept count of the FULL course (for "N of M on your map"). */
  fullTopicCount?: number
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
