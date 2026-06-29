import crypto from 'crypto'
import type { Db } from 'mongodb'
import {
  CURRICULUM_PROMPT_VERSION,
  LEGACY_CURRICULUM_PROMPT_VERSION,
  type CurriculumPromptVersion,
} from '../ai/skills/curriculumPrompt.ts'

export type CurriculumRolloutMode = 'legacy' | 'shadow' | 'canary' | 'v2'

export type CurriculumRolloutHealth = {
  healthy: boolean
  samples: number
  repairRate: number | null
  failureRate: number | null
  averageQuality: number | null
  reasons: string[]
}

export type CurriculumRolloutSelection = {
  mode: CurriculumRolloutMode
  rolloutPercent: number
  cohortBucket: number
  selectedVersion: CurriculumPromptVersion
  canarySelected: boolean
  collectShadow: boolean
  shadowVersion: CurriculumPromptVersion | null
  health: CurriculumRolloutHealth
}

const HEALTH_CACHE_MS = 60_000
let healthCache: { expiresAt: number; value: CurriculumRolloutHealth } | null = null

export function normalizeCurriculumRolloutMode(
  value: unknown,
): CurriculumRolloutMode {
  return value === 'legacy'
    || value === 'shadow'
    || value === 'canary'
    || value === 'v2'
    ? value
    : 'v2'
}

export function clampRolloutPercent(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100))
}

export function curriculumCohortBucket(input: {
  seed: string
  userId: string
  requestKey: string
}) {
  const digest = crypto
    .createHash('sha256')
    .update(`${input.seed}:${input.userId}:${input.requestKey}:curriculum`)
    .digest()
  return digest.readUInt32BE(0) / 0x1_0000_0000 * 100
}

export function resolveCurriculumRolloutSelection(input: {
  mode: CurriculumRolloutMode
  rolloutPercent: number
  seed: string
  userId: string
  requestKey: string
  health: CurriculumRolloutHealth
  shadowExecutionEnabled?: boolean
}): CurriculumRolloutSelection {
  const rolloutPercent = clampRolloutPercent(input.rolloutPercent)
  const cohortBucket = curriculumCohortBucket(input)
  const sampled = cohortBucket < rolloutPercent
  const canarySelected =
    input.mode === 'canary'
    && sampled
    && input.health.healthy

  let selectedVersion: CurriculumPromptVersion
  if (input.mode === 'legacy' || input.mode === 'shadow') {
    selectedVersion = LEGACY_CURRICULUM_PROMPT_VERSION
  } else if (input.mode === 'canary') {
    selectedVersion = canarySelected
      ? CURRICULUM_PROMPT_VERSION
      : LEGACY_CURRICULUM_PROMPT_VERSION
  } else {
    selectedVersion = input.health.healthy
      ? CURRICULUM_PROMPT_VERSION
      : LEGACY_CURRICULUM_PROMPT_VERSION
  }

  const collectShadow = Boolean(
    input.mode === 'shadow'
    && input.shadowExecutionEnabled
    && sampled,
  )

  return {
    mode: input.mode,
    rolloutPercent,
    cohortBucket,
    selectedVersion,
    canarySelected,
    collectShadow,
    shadowVersion: collectShadow ? CURRICULUM_PROMPT_VERSION : null,
    health: input.health,
  }
}

function threshold(name: string, fallback: number) {
  const value = Number(process.env[name])
  return Number.isFinite(value) ? value : fallback
}

export async function getCurriculumRolloutHealth(
  db: Db | null,
): Promise<CurriculumRolloutHealth> {
  if (process.env.CURRICULUM_HEALTH_GATE_DISABLED === '1') {
    return {
      healthy: true,
      samples: 0,
      repairRate: null,
      failureRate: null,
      averageQuality: null,
      reasons: ['Automatic curriculum rollback is temporarily disabled.'],
    }
  }
  if (!db) {
    return {
      healthy: true,
      samples: 0,
      repairRate: null,
      failureRate: null,
      averageQuality: null,
      reasons: ['Telemetry database unavailable; health gate is permissive.'],
    }
  }
  if (healthCache && healthCache.expiresAt > Date.now()) return healthCache.value

  const minSamples = Math.max(1, threshold('CURRICULUM_HEALTH_MIN_SAMPLES', 20))
  const maxRepairRate = threshold('CURRICULUM_HEALTH_MAX_REPAIR_RATE', 0.15)
  const maxFailureRate = threshold('CURRICULUM_HEALTH_MAX_FAILURE_RATE', 0.05)
  const minQuality = threshold('CURRICULUM_HEALTH_MIN_QUALITY', 90)
  const limit = Math.max(minSamples, threshold('CURRICULUM_HEALTH_WINDOW', 200))

  let rows
  try {
    rows = await db.collection('generationTelemetry')
      .find({
        feature: 'curriculum_generation',
        prompt_version: CURRICULUM_PROMPT_VERSION,
        event_type: 'curriculum_result',
      })
      .sort({ created_at: -1 })
      .limit(limit)
      .project({
        repair_attempted: 1,
        repair_outcome: 1,
        quality_score: 1,
        status: 1,
      })
      .toArray()
  } catch {
    return {
      healthy: true,
      samples: 0,
      repairRate: null,
      failureRate: null,
      averageQuality: null,
      reasons: ['Telemetry health query failed; health gate is permissive.'],
    }
  }

  if (rows.length < minSamples) {
    const value = {
      healthy: true,
      samples: rows.length,
      repairRate: null,
      failureRate: null,
      averageQuality: null,
      reasons: [`Need ${minSamples} samples before automatic rollback.`],
    }
    healthCache = { expiresAt: Date.now() + HEALTH_CACHE_MS, value }
    return value
  }

  const repairRate = rows.filter((row) => row.repair_attempted === true).length / rows.length
  const failureRate = rows.filter((row) =>
    row.status === 'failed'
    || row.repair_outcome === 'repair_failed',
  ).length / rows.length
  const qualityValues = rows
    .map((row) => Number(row.quality_score))
    .filter(Number.isFinite)
  const averageQuality = qualityValues.length
    ? qualityValues.reduce((sum, value) => sum + value, 0) / qualityValues.length
    : null
  const reasons: string[] = []
  if (repairRate > maxRepairRate) {
    reasons.push(`Repair rate ${(repairRate * 100).toFixed(1)}% exceeds ${(maxRepairRate * 100).toFixed(1)}%.`)
  }
  if (failureRate > maxFailureRate) {
    reasons.push(`Failure rate ${(failureRate * 100).toFixed(1)}% exceeds ${(maxFailureRate * 100).toFixed(1)}%.`)
  }
  if (averageQuality != null && averageQuality < minQuality) {
    reasons.push(`Average quality ${averageQuality.toFixed(1)} is below ${minQuality}.`)
  }

  const value = {
    healthy: reasons.length === 0,
    samples: rows.length,
    repairRate,
    failureRate,
    averageQuality,
    reasons,
  }
  healthCache = { expiresAt: Date.now() + HEALTH_CACHE_MS, value }
  return value
}

export function curriculumQualityScore(curriculum: any, mode: string) {
  const branches = Array.isArray(curriculum?.branches) ? curriculum.branches : []
  const topicCount = branches.reduce((sum: number, branch: any) =>
    sum + (Array.isArray(branch?.sections)
      ? branch.sections.reduce((sectionSum: number, section: any) =>
          sectionSum + (Array.isArray(section?.topics) ? section.topics.length : 0), 0)
      : 0), 0)
  if (!branches.length || !topicCount) return 0

  let score = 100
  if (!String(curriculum?.title ?? '').trim()) score -= 10
  if (!String(curriculum?.structure_reasoning ?? '').trim()) score -= 5
  if (mode === 'source_grounded') {
    const issues = curriculum?.source_validation_report?.issues ?? []
    score -= Math.min(40, issues.length * 8)
    const outcome = curriculum?.source_model_repair_report?.outcome
    if (outcome === 'fallback_cleanup') score -= 8
    if (outcome === 'repair_failed') score -= 20
  }
  return Math.max(0, score)
}

function topicIds(curriculum: any) {
  const ids: string[] = []
  const visit = (topic: any) => {
    const id = String(topic?.id ?? '').trim()
    if (id) ids.push(id)
    for (const child of Array.isArray(topic?.children) ? topic.children : []) visit(child)
  }
  for (const branch of Array.isArray(curriculum?.branches) ? curriculum.branches : []) {
    for (const section of Array.isArray(branch?.sections) ? branch.sections : []) {
      for (const topic of Array.isArray(section?.topics) ? section.topics : []) visit(topic)
    }
  }
  return ids
}

export function compareCurriculumCandidates(primary: any, shadow: any) {
  const primaryIds = topicIds(primary)
  const shadowIds = topicIds(shadow)
  const shadowSet = new Set(shadowIds)
  const overlap = primaryIds.length || shadowIds.length
    ? primaryIds.filter((id) => shadowSet.has(id)).length
      / Math.max(primaryIds.length, shadowIds.length)
    : 1
  return {
    primary_topic_count: primaryIds.length,
    shadow_topic_count: shadowIds.length,
    topic_id_overlap: overlap,
    primary_branch_count: Array.isArray(primary?.branches) ? primary.branches.length : 0,
    shadow_branch_count: Array.isArray(shadow?.branches) ? shadow.branches.length : 0,
  }
}
