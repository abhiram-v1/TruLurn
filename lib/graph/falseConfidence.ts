// Decides whether a completed exam session showed "false confidence" — the
// learner passed but the model still flagged concepts worth revisiting, or a
// turn-level evaluation explicitly flagged it. Pulled out as a pure function so
// the graph route's display flag (GraphNode.falseConfidence) can be unit-tested
// without a database, and so the condition can't silently regress into a
// tautology again (the previous inline version included `&& !summary.passed`
// after already requiring `summary.passed`, which could never be true).

export type ExamSessionSummaryLike = {
  passed?: unknown
  review_concepts?: unknown
  false_confidence?: unknown
} | null | undefined

export function detectFalseConfidence(summary: ExamSessionSummaryLike): boolean {
  if (!summary || typeof summary !== 'object') return false
  if (summary.false_confidence === true) return true
  return Boolean(summary.passed)
    && Array.isArray(summary.review_concepts)
    && summary.review_concepts.length > 0
}
