// ── TruViz — Data Chart specification types ───────────────────────────────────
// Consumed by the DataChart renderer via the TruViz pipeline.
// AI emits these specs inside ```chart fences in lesson/chat markdown.

export type ChartType =
  | 'bar' | 'line' | 'scatter' | 'pie' | 'histogram' | 'area'
  | 'radar'   // spider chart — compare multiple metrics across models/groups
  | 'bubble'  // scatter with size-encoded third variable
  | 'heatmap' // grid of colored cells — confusion matrices, correlation matrices
  | 'box'     // box-and-whisker — distribution comparison across categories

export type ChartSeries = {
  /** Data key in each row object */
  key: string
  /** Human-readable label for legend and tooltip */
  label?: string
  /** Hex color override — falls back to palette if omitted */
  color?: string
  /** Stack group ID — enables stacked bar/area when set to the same string across series */
  stackId?: string
}

export type DataChartSpec = {
  type: 'data-chart'
  chartType: ChartType
  /** Short descriptive title shown above the chart */
  title?: string
  /** Optional one-sentence context shown below the title */
  description?: string
  /**
   * Flat array of data row objects.
   * Every key referenced by xAxis.key and series[n].key must exist in each row.
   * Max 200 rows.
   */
  data: Record<string, unknown>[]
  /** Required for bar, line, area, scatter, histogram, radar, bubble.
   *  For heatmap: key for column categories.
   *  For box: key for the category label (the group name).
   *  Not used for pie. */
  xAxis?: { key: string; label?: string }
  yAxis?: {
    label?: string
    /** Axis domain override, e.g. [0, 'auto'] to force zero baseline */
    domain?: [number | 'auto', number | 'auto']
  }
  /**
   * Required for bar, line, area, scatter, histogram, radar, bubble.
   * For heatmap: series[0].key is the row-category key; "value" is always the cell value key.
   * Not used for pie (uses "name"/"value" keys) or box (uses "min"/"q1"/"median"/"q3"/"max" keys).
   * Max 8 series.
   */
  series?: ChartSeries[]
  config?: {
    /** Chart height in px. Default: 300. Clamped to 80–500. */
    height?: number
    /** Show legend. Default: true when series.length > 1. */
    showLegend?: boolean
    /** Show grid lines. Default: true. */
    showGrid?: boolean
    /** Fill opacity for area/radar charts (0–1). Default: 0.25 for area, 0.18 for radar. */
    fillOpacity?: number
    /** bubble only: data key that drives bubble size. Default: "z". */
    bubbleSizeKey?: string
    /** bubble only: pixel range [min, max] for bubble sizes. Default: [40, 600]. */
    bubbleSizeRange?: [number, number]
    /** heatmap only: use a diverging red–white–blue scale instead of sequential blue. Default: false. */
    divergingScale?: boolean
  }
}
