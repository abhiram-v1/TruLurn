import crypto from 'crypto'
import { getDb } from '@/lib/db'
import type { AIProviderUsage } from '@/lib/ai/types'
import { estimateCurriculumCost } from './curriculumCost'

export type CurriculumRepairOutcome =
  | 'not_needed'
  | 'repaired'
  | 'partially_repaired'
  | 'fallback_cleanup'
  | 'repair_failed'

export function recordCurriculumRepairTelemetry(event: {
  mode: string
  userId?: string | null
  promptVersion: string
  repairPromptVersion: string
  initialProvider?: string
  initialModel?: string
  repairProvider?: string
  repairModel?: string
  attempted: boolean
  outcome: CurriculumRepairOutcome
  durationMs?: number
  initialIssueCodes: string[]
  remainingIssueCodes: string[]
}) {
  if (
    process.env.AI_USAGE_PERSISTENCE_DISABLED === '1'
    || !process.env.MONGODB_URI
  ) return

  void getDb()
    .then((db) => db.collection('generationTelemetry').insertOne({
      _id: crypto.randomUUID() as any,
      feature: 'curriculum_generation',
      mode: event.mode,
      user_id: event.userId ?? null,
      prompt_version: event.promptVersion,
      repair_prompt_version: event.repairPromptVersion,
      initial_provider: event.initialProvider ?? null,
      initial_model: event.initialModel ?? null,
      repair_provider: event.repairProvider ?? null,
      repair_model: event.repairModel ?? null,
      repair_attempted: event.attempted,
      repair_outcome: event.outcome,
      repair_duration_ms: event.durationMs == null
        ? null
        : Math.round(event.durationMs),
      initial_issue_codes: [...new Set(event.initialIssueCodes)],
      remaining_issue_codes: [...new Set(event.remainingIssueCodes)],
      created_at: new Date(),
    }))
    .catch(() => {
      // Curriculum observability must never interrupt course generation.
    })
}

export function recordCurriculumResultTelemetry(event: {
  mode: string
  userId?: string | null
  promptVersion: string
  rolloutMode: string
  cohortBucket: number
  provider?: string
  model?: string
  status: 'succeeded' | 'failed'
  durationMs: number
  qualityScore: number
  repairAttempted: boolean
  repairOutcome?: string | null
  healthForcedRollback: boolean
  usage?: AIProviderUsage
  error?: unknown
}) {
  if (
    process.env.AI_USAGE_PERSISTENCE_DISABLED === '1'
    || !process.env.MONGODB_URI
  ) return

  void getDb()
    .then((db) => db.collection('generationTelemetry').insertOne({
      _id: crypto.randomUUID() as any,
      event_type: 'curriculum_result',
      feature: 'curriculum_generation',
      mode: event.mode,
      user_id: event.userId ?? null,
      prompt_version: event.promptVersion,
      rollout_mode: event.rolloutMode,
      cohort_bucket: event.cohortBucket,
      provider: event.provider ?? null,
      model: event.model ?? null,
      status: event.status,
      duration_ms: Math.round(event.durationMs),
      quality_score: event.qualityScore,
      repair_attempted: event.repairAttempted,
      repair_outcome: event.repairOutcome ?? null,
      health_forced_rollback: event.healthForcedRollback,
      input_tokens: event.usage?.inputTokens ?? null,
      cached_input_tokens: event.usage?.cachedInputTokens ?? null,
      output_tokens: event.usage?.outputTokens ?? null,
      total_tokens: event.usage?.totalTokens ?? null,
      estimated_cost_usd: estimateCurriculumCost(event.usage),
      error: event.error instanceof Error ? event.error.message : null,
      created_at: new Date(),
    }))
    .catch(() => {})
}

export function recordCurriculumShadowTelemetry(event: {
  userId?: string | null
  mode: string
  primaryVersion: string
  shadowVersion: string
  primaryQuality: number
  shadowQuality: number
  comparison: Record<string, unknown>
  shadowProvider?: string
  shadowModel?: string
  shadowUsage?: AIProviderUsage
  durationMs: number
  status: 'succeeded' | 'failed'
  error?: unknown
}) {
  if (
    process.env.AI_USAGE_PERSISTENCE_DISABLED === '1'
    || !process.env.MONGODB_URI
  ) return

  void getDb()
    .then((db) => db.collection('generationTelemetry').insertOne({
      _id: crypto.randomUUID() as any,
      event_type: 'curriculum_shadow_comparison',
      feature: 'curriculum_generation',
      user_id: event.userId ?? null,
      mode: event.mode,
      primary_prompt_version: event.primaryVersion,
      shadow_prompt_version: event.shadowVersion,
      primary_quality_score: event.primaryQuality,
      shadow_quality_score: event.shadowQuality,
      comparison: event.comparison,
      shadow_provider: event.shadowProvider ?? null,
      shadow_model: event.shadowModel ?? null,
      shadow_input_tokens: event.shadowUsage?.inputTokens ?? null,
      shadow_cached_input_tokens: event.shadowUsage?.cachedInputTokens ?? null,
      shadow_output_tokens: event.shadowUsage?.outputTokens ?? null,
      shadow_total_tokens: event.shadowUsage?.totalTokens ?? null,
      shadow_estimated_cost_usd: estimateCurriculumCost(event.shadowUsage),
      duration_ms: Math.round(event.durationMs),
      status: event.status,
      error: event.error instanceof Error ? event.error.message : null,
      created_at: new Date(),
    }))
    .catch(() => {})
}
