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

export type VectorTuple = [number, number] | [number, number, number]

export type CoordinateVector = {
  /** Vector tail. Defaults to the origin. */
  from?: VectorTuple
  /** Vector head in Cartesian coordinates. */
  to: VectorTuple
  /** Short mathematical label, for example "v" or "u + v". */
  label?: string
  /** Optional hex color. */
  color?: string
  /** Emphasize this vector relative to construction vectors. */
  emphasis?: 'primary' | 'secondary' | 'muted'
  /** Draw a dashed construction vector. */
  dashed?: boolean
}

export type CoordinatePoint = {
  at: VectorTuple
  label?: string
  color?: string
}

/** Cartesian vector diagram for geometry and linear-algebra explanations. */
export type CoordinateVectorsSpec = {
  type: 'coordinate-vectors'
  dimensions: 2 | 3
  vectors: CoordinateVector[]
  points?: CoordinatePoint[]
  title?: string
  description?: string
  axisLabels?: [string, string] | [string, string, string]
  /** Explicit symmetric axis extent. Auto-computed when omitted. */
  extent?: number
  showGrid?: boolean
  showCoordinates?: boolean
}

export type { DataChartSpec, ChartType, ChartSeries } from './chartSpec'
import type { DataChartSpec } from './chartSpec'

// ── Future diagram types go here ──────────────────────────────────────────────
// export type AttentionMapSpec = { type: 'attention-map'; ... }
// export type DecisionTreeSpec = { type: 'decision-tree'; ... }

export type TruVizSpec = NeuralNetSpec | DataChartSpec | CoordinateVectorsSpec

export type ParseResult =
  | { ok: true; spec: TruVizSpec }
  | { ok: false; error: string; raw: string }
