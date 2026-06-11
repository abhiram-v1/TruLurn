// ── TruViz — TruLurn's custom educational diagram renderer ────────────────────
// Add new diagram types as a union member of TruVizSpec.

/** A single layer in a neural network diagram */
export type NeuralNetLayer = {
  /** Number of nodes in this layer */
  size: number
  /** Label shown below the layer (default: "Input" / "Hidden" / "Output") */
  label?: string
  /** Individual node labels — short ones render inside the circle, longer ones below */
  nodeLabels?: string[]
  /** Activation function shown in small text under the layer label */
  activation?: string
  /** Highlight this entire layer */
  highlight?: boolean
}

/**
 * A specific forward-pass path through the network.
 * Consecutive node pairs get a highlighted connection drawn between them.
 */
export type HighlightPath = {
  /** Ordered [layerIndex, nodeIndex] pairs. Consecutive pairs → highlighted connection */
  nodes: Array<[number, number]>
  /** Override highlight color (default: amber) */
  color?: string
  /** Optional label shown near the highlighted path */
  label?: string
}

export type NeuralNetSpec = {
  type: 'neural-net'
  layers: NeuralNetLayer[]
  /** Shown at the top of the diagram */
  title?: string
  /** Shown below the title in smaller text */
  subtitle?: string
  /** 'full' draws all connections (default), 'none' draws no connections */
  connections?: 'full' | 'none'
  /** Highlight a specific signal path (nodes + the connections between consecutive pairs) */
  highlightPath?: HighlightPath
  /** Highlight entire layers by index (0 = first layer) */
  highlightLayers?: number[]
  /** Highlight individual nodes by [layerIndex, nodeIndex] */
  highlightNodes?: Array<[number, number]>
  /**
   * Force compact mode (smaller nodes + tighter spacing).
   * Auto-enabled for networks with > 7 layers.
   */
  compact?: boolean
}

// ── Future diagram types go here ──────────────────────────────────────────────
// export type AttentionMapSpec = { type: 'attention-map'; ... }
// export type DecisionTreeSpec = { type: 'decision-tree'; ... }

export type TruVizSpec = NeuralNetSpec // | AttentionMapSpec | DecisionTreeSpec | …

export type ParseResult =
  | { ok: true; spec: TruVizSpec }
  | { ok: false; error: string; raw: string }
