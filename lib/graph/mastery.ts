// Shared conversion between the stored 1–5 understanding_level and the 0–100
// mastery percentage used throughout the graph/UI layer. Two independent
// implementations of this exact formula previously existed (transform.ts's
// toMastery and graphEvaluator.ts's levelToMastery), plus an inline reverse
// conversion in examEngine.ts — kept here once so the read and write
// directions can never drift out of sync with each other.

export function levelToMasteryPercent(level: number | null | undefined): number {
  if (!level) return 0
  return Math.min(100, Math.round(level * 20))
}

export function masteryPercentToLevel(mastery: number | null | undefined): number {
  return Math.round(Number(mastery ?? 0) / 20)
}
