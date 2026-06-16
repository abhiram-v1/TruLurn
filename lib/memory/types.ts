export type LearnerMemoryKind =
  | 'preference'
  | 'goal'
  | 'profile'
  | 'observation'

export type LearnerMemoryAuthority =
  | 'explicit_user'
  | 'course_setting'
  | 'validated_assessment'
  | 'repeated_behavior'
  | 'single_inference'

export type LearnerMemoryStatus =
  | 'candidate'
  | 'active'
  | 'contradicted'
  | 'superseded'
  | 'expired'
  | 'deleted'

export type LearnerMemoryRecord = {
  id: string
  user_id: string
  course_id: string | null
  kind: LearnerMemoryKind
  key: string
  value: unknown
  confidence: number
  effective_confidence: number
  authority: LearnerMemoryAuthority
  source: string
  evidence_refs: string[]
  status: LearnerMemoryStatus
  valid_from: Date
  valid_to: Date | null
  half_life_days: number | null
  sensitivity: 'standard'
  schema_version: 'learner-memory-v2'
  created_at: Date
  updated_at: Date
}

export type LearnerSkillState = {
  course_id: string
  skill_key: string
  label: string
  topic_id: string | null
  evidence_count: number
  successful_evidence: number
  failed_evidence: number
  alpha: number
  beta: number
  posterior_mastery: number
  effective_mastery: number
  stability_days: number
  state: 'unknown' | 'developing' | 'functional' | 'strong'
  last_assessed_at: Date | null
}

export type LearnerConceptState = {
  course_id: string
  concept_key: string
  label: string
  topic_id: string | null
  stage:
    | 'never_encountered'
    | 'recognizes'
    | 'understands'
    | 'applies'
    | 'transfers'
    | 'forgetting'
  confidence: number
  freshness: 'fresh' | 'aging' | 'stale' | 'unknown'
  source: 'observed' | 'validated_assessment' | 'explicit_user' | 'none'
  evidence_count: number
  evidence_summary: Record<string, number>
  evidence_refs: string[]
  last_evidence_at: Date | null
  updated_at: Date
}

export type LearnerMisconceptionState = {
  course_id: string
  misconception_key: string
  skill_key: string
  label: string
  topic_id: string | null
  description: string
  confidence: number
  evidence_count: number
  correction_evidence_count: number
  status: 'active' | 'corrected'
  detected_at: Date
  corrected_at: Date | null
}
