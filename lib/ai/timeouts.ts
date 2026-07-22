import type { AIFeature } from './types.ts'

// Most AI calls should fail fast enough for provider fallback to remain useful.
// Course planning is different: it uses a frontier reasoning model to produce a
// large, structured curriculum and legitimately needs several minutes. Keep its
// wider ceiling feature-scoped so a stalled chat or classifier does not occupy a
// worker for the same amount of time.
const FEATURE_TIMEOUT_DEFAULTS_MS: Partial<Record<AIFeature, number>> = {
  curriculum_generation: 240_000,
}

function featureTimeoutEnvironmentKey(feature: AIFeature) {
  return `AI_FEATURE_${feature.toUpperCase()}_TIMEOUT_MS`
}

export function resolveAIFeatureTimeoutMs(
  feature: AIFeature,
  explicitTimeoutMs?: number,
) {
  if (explicitTimeoutMs !== undefined) return explicitTimeoutMs

  const environmentKey = featureTimeoutEnvironmentKey(feature)
  const configured = process.env[environmentKey]?.trim()
  if (configured) {
    const timeoutMs = Number(configured)
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error(`${environmentKey} must be a positive number of milliseconds.`)
    }
    return timeoutMs
  }

  return FEATURE_TIMEOUT_DEFAULTS_MS[feature]
}

