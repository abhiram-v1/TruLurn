import crypto from 'crypto'
import { getDb } from '@/lib/db'
import type { AIFeature, AIProviderName, AIProviderUsage } from '@/lib/ai/types'

type AIUsageEvent = {
  feature: AIFeature
  provider?: AIProviderName
  model?: string
  operation: 'generation' | 'search' | 'embedding'
  status: 'succeeded' | 'failed' | 'avoided'
  durationMs?: number
  systemChars?: number
  userChars?: number
  estimatedInputTokens?: number
  usage?: AIProviderUsage
  reason?: string
  error?: unknown
}

function errorCategory(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? '').toLowerCase()
  if (!message) return null
  if (message.includes('timed out') || message.includes('timeout')) return 'timeout'
  if (message.includes('rate') || message.includes('429')) return 'rate_limit'
  if (message.includes('quota') || message.includes('billing')) return 'quota'
  if (message.includes('invalid response') || message.includes('json')) return 'invalid_response'
  if (message.includes('not configured') || message.includes('missing')) return 'configuration'
  if (message.includes('abort')) return 'aborted'
  if (message.includes('fetch failed') || message.includes('network')) return 'network'
  return 'provider_error'
}

export function recordAIUsageEvent(event: AIUsageEvent) {
  if (
    process.env.AI_USAGE_PERSISTENCE_DISABLED === '1'
    || !process.env.MONGODB_URI
  ) return

  void getDb()
    .then((db) => db.collection('aiUsageEvents').insertOne({
      _id: crypto.randomUUID() as any,
      feature: event.feature,
      provider: event.provider ?? null,
      model: event.model ?? null,
      operation: event.operation,
      status: event.status,
      duration_ms: event.durationMs == null ? null : Math.round(event.durationMs),
      system_chars: event.systemChars ?? null,
      user_chars: event.userChars ?? null,
      estimated_input_tokens: event.estimatedInputTokens ?? null,
      input_tokens: event.usage?.inputTokens ?? null,
      cached_input_tokens: event.usage?.cachedInputTokens ?? null,
      output_tokens: event.usage?.outputTokens ?? null,
      total_tokens: event.usage?.totalTokens ?? null,
      reason: event.reason ?? null,
      error_category: errorCategory(event.error),
      created_at: new Date(),
    }))
    .catch(() => {
      // Usage accounting must never disturb the learner-facing operation.
    })
}
