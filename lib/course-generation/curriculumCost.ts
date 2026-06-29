import type { AIProviderUsage } from '../ai/types.ts'

export function estimateCurriculumCost(
  usage?: AIProviderUsage,
): number | null {
  if (!usage) return null
  const inputRate = Number(process.env.CURRICULUM_INPUT_USD_PER_MILLION)
  const cachedInputRate = Number(
    process.env.CURRICULUM_CACHED_INPUT_USD_PER_MILLION,
  )
  const outputRate = Number(process.env.CURRICULUM_OUTPUT_USD_PER_MILLION)
  if (!Number.isFinite(inputRate) || !Number.isFinite(outputRate)) return null

  const cached = Math.max(0, usage.cachedInputTokens ?? 0)
  const input = Math.max(0, (usage.inputTokens ?? 0) - cached)
  const output = Math.max(0, usage.outputTokens ?? 0)
  const effectiveCachedRate = Number.isFinite(cachedInputRate)
    ? cachedInputRate
    : inputRate
  return (
    input * inputRate
    + cached * effectiveCachedRate
    + output * outputRate
  ) / 1_000_000
}
