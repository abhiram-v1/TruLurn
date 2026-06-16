export type ConceptKnowledgeStage =
  | 'never_encountered'
  | 'recognizes'
  | 'understands'
  | 'applies'
  | 'transfers'
  | 'forgetting'

export type ConceptEvidenceKind =
  | 'lesson_view'
  | 'lesson_feedback'
  | 'recall_prompt'
  | 'chat_discussion'
  | 'assessment_recall'
  | 'assessment_explain'
  | 'assessment_apply'
  | 'assessment_transfer'
  | 'user_correction'

export type ConceptEvidence = {
  id: string
  kind: ConceptEvidenceKind
  successful?: boolean | null
  weight: number
  observed_at: Date
}

export type ConceptKnowledgeEstimate = {
  stage: ConceptKnowledgeStage
  confidence: number
  evidence_count: number
  evidence_summary: Partial<Record<ConceptEvidenceKind, number>>
  last_evidence_at: Date | null
  freshness: 'fresh' | 'aging' | 'stale' | 'unknown'
  source: 'observed' | 'validated_assessment' | 'explicit_user' | 'none'
}

const ASSESSED_KINDS = new Set<ConceptEvidenceKind>([
  'assessment_recall',
  'assessment_explain',
  'assessment_apply',
  'assessment_transfer',
])

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

function freshness(lastEvidenceAt: Date | null, now: Date) {
  if (!lastEvidenceAt) return 'unknown' as const
  const ageDays = Math.max(0, now.getTime() - lastEvidenceAt.getTime()) / 86_400_000
  if (ageDays <= 14) return 'fresh' as const
  if (ageDays <= 45) return 'aging' as const
  return 'stale' as const
}

function successfulWeight(evidence: ConceptEvidence[], kinds: ConceptEvidenceKind[]) {
  return evidence
    .filter((item) => kinds.includes(item.kind) && item.successful === true)
    .reduce((sum, item) => sum + item.weight, 0)
}

function failedWeight(evidence: ConceptEvidence[]) {
  return evidence
    .filter((item) => ASSESSED_KINDS.has(item.kind) && item.successful === false)
    .reduce((sum, item) => sum + item.weight, 0)
}

export function deriveConceptKnowledgeEstimate(
  evidence: ConceptEvidence[],
  now = new Date(),
): ConceptKnowledgeEstimate {
  const ordered = [...evidence]
    .filter((item) => item.id && Number.isFinite(item.observed_at.getTime()))
    .sort((left, right) => left.observed_at.getTime() - right.observed_at.getTime())
  const summary: ConceptKnowledgeEstimate['evidence_summary'] = {}
  for (const item of ordered) summary[item.kind] = (summary[item.kind] ?? 0) + 1

  const lastEvidenceAt = ordered.at(-1)?.observed_at ?? null
  if (!ordered.length) {
    return {
      stage: 'never_encountered',
      confidence: 1,
      evidence_count: 0,
      evidence_summary: {},
      last_evidence_at: null,
      freshness: 'unknown',
      source: 'none',
    }
  }

  const explicit = ordered.filter((item) => item.kind === 'user_correction').at(-1)
  const exposureCount = ordered.filter((item) => !ASSESSED_KINDS.has(item.kind)).length
  const recallWeight = successfulWeight(ordered, ['assessment_recall', 'assessment_explain'])
  const applyWeight = successfulWeight(ordered, ['assessment_apply'])
  const transferWeight = successfulWeight(ordered, ['assessment_transfer'])
  const failures = failedWeight(ordered)
  const assessed = ordered.filter((item) => ASSESSED_KINDS.has(item.kind))
  const lastAssessedAt = assessed.at(-1)?.observed_at ?? null
  const assessedWeight = assessed.reduce((sum, item) => sum + item.weight, 0)
  const successfulAssessedWeight = assessed
    .filter((item) => item.successful === true)
    .reduce((sum, item) => sum + item.weight, 0)
  const performance = assessedWeight
    ? successfulAssessedWeight / assessedWeight
    : 0

  let stage: ConceptKnowledgeStage = 'recognizes'
  if (recallWeight >= 1.8 && performance >= 0.6) stage = 'understands'
  if (applyWeight >= 1.8 && performance >= 0.65) stage = 'applies'
  if (transferWeight >= 2 && applyWeight >= 1 && performance >= 0.72) stage = 'transfers'

  const currentFreshness = freshness(lastAssessedAt ?? lastEvidenceAt, now)
  if (
    currentFreshness === 'stale'
    && assessed.length >= 2
    && ['understands', 'applies', 'transfers'].includes(stage)
  ) {
    stage = 'forgetting'
  }

  const evidenceBreadth = Object.keys(summary).length
  const confidence = clamp(
    0.25
    + Math.min(0.25, exposureCount * 0.04)
    + Math.min(0.35, assessedWeight * 0.08)
    + Math.min(0.15, evidenceBreadth * 0.03)
    - Math.min(0.2, failures * 0.04),
  )

  return {
    stage,
    confidence: explicit ? Math.max(confidence, clamp(explicit.weight)) : confidence,
    evidence_count: ordered.length,
    evidence_summary: summary,
    last_evidence_at: lastEvidenceAt,
    freshness: currentFreshness,
    source: explicit
      ? 'explicit_user'
      : assessed.length
        ? 'validated_assessment'
        : 'observed',
  }
}

export function normalizeConceptKey(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function conceptTeachingGuidance(
  label: string,
  estimate: Pick<ConceptKnowledgeEstimate, 'stage' | 'source' | 'evidence_count' | 'freshness'>,
) {
  const evidence = estimate.source === 'explicit_user'
    ? 'learner-corrected'
    : `${estimate.evidence_count} evidence item${estimate.evidence_count === 1 ? '' : 's'}, ${estimate.freshness}`
  if (estimate.stage === 'never_encountered') {
    return `${label}: never encountered (${evidence}). Introduce it before depending on it.`
  }
  if (estimate.stage === 'recognizes') {
    return `${label}: recognizes the idea but has not demonstrated understanding (${evidence}). Do not treat familiarity as mastery.`
  }
  if (estimate.stage === 'understands') {
    return `${label}: can explain the idea (${evidence}), but application is not yet established.`
  }
  if (estimate.stage === 'applies') {
    return `${label}: can apply the idea in assessed contexts (${evidence}). Build on it without reteaching basics.`
  }
  if (estimate.stage === 'transfers') {
    return `${label}: has demonstrated transfer to harder contexts (${evidence}). Use it as a strong anchor.`
  }
  return `${label}: previously demonstrated knowledge is aging (${evidence}). Use a short retrieval cue before building on it.`
}
