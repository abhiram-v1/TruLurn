// Pure, dependency-free source-ordering heuristics. Kept separate from
// sourceOrdering.ts (which imports the AI router) so the logic is unit-testable
// under node:test without resolving the "@/" path alias.

type OrderableSource = { index: number; title: string }

// Extract an explicit sequence number from a source title/filename, e.g.
// "Unit 1", "Lecture 02", "Chapter 3", "Week 4", "01 - Intro", "Ch2".
export function extractSequenceNumber(title: string): number | null {
  const keyword = title
    .toLowerCase()
    .match(/\b(unit|lecture|chapter|week|part|module|lesson|session|day|topic|ch|lec)\s*\.?\s*#?\s*(\d+)/)
  if (keyword) return Number(keyword[2])

  const leading = title.match(/^\s*#?\s*(\d{1,3})\b/)
  if (leading) return Number(leading[1])

  return null
}

// Returns a deterministic order of source indices when every source carries a
// clear, unique sequence number; otherwise null (genuinely ambiguous → let the
// ordering model decide). This avoids an AI call for the common case of
// explicitly numbered lecture/chapter files.
export function deriveDeterministicOrder(blocks: OrderableSource[]): number[] | null {
  const pairs = blocks.map((block) => ({ index: block.index, seq: extractSequenceNumber(block.title) }))
  if (pairs.some((pair) => pair.seq === null)) return null

  const seqs = pairs.map((pair) => pair.seq as number)
  if (new Set(seqs).size !== seqs.length) return null

  return [...pairs]
    .sort((a, b) => (a.seq as number) - (b.seq as number))
    .map((pair) => pair.index)
}
