export const TRULURN_CHART_PALETTE = [
  '#d36d4a', // terracotta
  '#71845d', // sage
  '#496477', // slate
  '#b18a58', // parchment ochre
  '#7e6b8f', // muted aubergine
  '#5f8582', // mineral teal
  '#a85f62', // faded carmine
  '#8a8174', // warm graphite
] as const

export function chartColor(index: number) {
  return TRULURN_CHART_PALETTE[index % TRULURN_CHART_PALETTE.length]
}

export function chartSeriesColors(count: number) {
  return Array.from({ length: Math.max(0, count) }, (_, index) => chartColor(index))
}
