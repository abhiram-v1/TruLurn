import { createHash } from 'crypto'
import { getAIProvider } from '@/lib/ai/providers/registry'
import { resolveAIFeatureRoute } from '@/lib/ai/routing'
import { recordAIUsageEvent } from '@/lib/ai/usage'
import { GEMINI_EMBEDDING_DIMENSIONS } from '@/lib/ai/gemini/embeddings'
import { OPENAI_EMBEDDING_DIMENSIONS } from '@/lib/ai/openai/embeddings'
import type { AIEmbeddingTask } from '@/lib/ai/types'

export type EmbeddingTask = AIEmbeddingTask

const embeddingRoute = resolveAIFeatureRoute('embeddings')

export const ACTIVE_EMBEDDING_PROVIDER = embeddingRoute.provider

export const ACTIVE_EMBEDDING_DIMENSIONS = Number(
  process.env.AI_FEATURE_EMBEDDINGS_DIMENSIONS
    ?? (embeddingRoute.provider === 'openai'
      ? process.env.OPENAI_EMBEDDING_DIMENSIONS ?? OPENAI_EMBEDDING_DIMENSIONS
      : process.env.GEMINI_EMBEDDING_DIMENSIONS ?? GEMINI_EMBEDDING_DIMENSIONS),
)

export const ACTIVE_EMBEDDING_MODEL = embeddingRoute.model
  ?? (embeddingRoute.provider === 'openai' ? 'text-embedding-3-small' : 'gemini-embedding-001')

export const ACTIVE_EMBEDDING_VERSION = [
  'rag-v2',
  ACTIVE_EMBEDDING_PROVIDER,
  ACTIVE_EMBEDDING_MODEL,
  ACTIVE_EMBEDDING_DIMENSIONS,
  'content-v1',
].join(':')

const EMBEDDING_CACHE_MAX = 256
const QUERY_CACHE_TTL_MS = 15 * 60_000
const DOCUMENT_CACHE_TTL_MS = 60 * 60_000
const embeddingCache = new Map<string, { vector: number[]; expiresAt: number }>()
const embeddingFlights = new Map<string, Promise<number[]>>()

function embeddingKey(text: string, taskType: EmbeddingTask) {
  return createHash('sha256')
    .update(ACTIVE_EMBEDDING_VERSION)
    .update('\0')
    .update(taskType)
    .update('\0')
    .update(text)
    .digest('hex')
}

function readCachedEmbedding(key: string) {
  const cached = embeddingCache.get(key)
  if (!cached) return null
  if (cached.expiresAt <= Date.now()) {
    embeddingCache.delete(key)
    return null
  }
  embeddingCache.delete(key)
  embeddingCache.set(key, cached)
  return cached.vector
}

function logEmbeddingEvent(source: 'provider' | 'cache' | 'singleflight', text: string, taskType: EmbeddingTask) {
  if (source !== 'provider') {
    recordAIUsageEvent({
      feature: 'embeddings',
      provider: ACTIVE_EMBEDDING_PROVIDER,
      model: ACTIVE_EMBEDDING_MODEL,
      operation: 'embedding',
      status: 'avoided',
      estimatedInputTokens: Math.ceil(text.length / 4),
      reason: source,
    })
  }
  if (process.env.LOG_AI_USAGE !== '1') return
  console.info(JSON.stringify({
    event: source === 'provider' ? 'embedding_request' : 'ai_call_avoided',
    provider: ACTIVE_EMBEDDING_PROVIDER,
    model: ACTIVE_EMBEDDING_MODEL,
    task_type: taskType,
    source,
    estimated_input_tokens: Math.ceil(text.length / 4),
  }))
}

function cacheEmbedding(key: string, taskType: EmbeddingTask, vector: number[]) {
  const queryTask = taskType === 'RETRIEVAL_QUERY' || taskType === 'QUESTION_ANSWERING'
  embeddingCache.set(key, {
    vector,
    expiresAt: Date.now() + (queryTask ? QUERY_CACHE_TTL_MS : DOCUMENT_CACHE_TTL_MS),
  })
  while (embeddingCache.size > EMBEDDING_CACHE_MAX) {
    const oldest = embeddingCache.keys().next().value
    if (!oldest) break
    embeddingCache.delete(oldest)
  }
}

export async function embedText(
  text: string,
  taskType: EmbeddingTask = 'SEMANTIC_SIMILARITY',
): Promise<number[]> {
  const provider = getAIProvider(embeddingRoute.provider)

  if (!provider.capabilities.has('embeddings') || !provider.embed) {
    throw new Error(`AI provider "${embeddingRoute.provider}" does not support embeddings.`)
  }

  if (!provider.isConfigured()) {
    throw new Error(
      `AI provider "${embeddingRoute.provider}" is selected for embeddings but is not configured.`,
    )
  }

  if (process.env.AI_EMBEDDING_CACHE_DISABLED === '1') {
    const startedAt = performance.now()
    try {
      const vector = await provider.embed({
        text,
        taskType,
        model: ACTIVE_EMBEDDING_MODEL,
        dimensions: ACTIVE_EMBEDDING_DIMENSIONS,
      })
      recordAIUsageEvent({
        feature: 'embeddings',
        provider: ACTIVE_EMBEDDING_PROVIDER,
        model: ACTIVE_EMBEDDING_MODEL,
        operation: 'embedding',
        status: 'succeeded',
        durationMs: performance.now() - startedAt,
        estimatedInputTokens: Math.ceil(text.length / 4),
        reason: taskType,
      })
      return vector
    } catch (error) {
      recordAIUsageEvent({
        feature: 'embeddings',
        provider: ACTIVE_EMBEDDING_PROVIDER,
        model: ACTIVE_EMBEDDING_MODEL,
        operation: 'embedding',
        status: 'failed',
        durationMs: performance.now() - startedAt,
        estimatedInputTokens: Math.ceil(text.length / 4),
        reason: taskType,
        error,
      })
      throw error
    }
  }

  const key = embeddingKey(text, taskType)
  const cached = readCachedEmbedding(key)
  if (cached) {
    logEmbeddingEvent('cache', text, taskType)
    return cached
  }

  const inFlight = embeddingFlights.get(key)
  if (inFlight) {
    logEmbeddingEvent('singleflight', text, taskType)
    return inFlight
  }

  logEmbeddingEvent('provider', text, taskType)
  const startedAt = performance.now()
  const pending = provider.embed({
    text,
    taskType,
    model: ACTIVE_EMBEDDING_MODEL,
    dimensions: ACTIVE_EMBEDDING_DIMENSIONS,
  })
  embeddingFlights.set(key, pending)
  try {
    const vector = await pending
    recordAIUsageEvent({
      feature: 'embeddings',
      provider: ACTIVE_EMBEDDING_PROVIDER,
      model: ACTIVE_EMBEDDING_MODEL,
      operation: 'embedding',
      status: 'succeeded',
      durationMs: performance.now() - startedAt,
      estimatedInputTokens: Math.ceil(text.length / 4),
      reason: taskType,
    })
    cacheEmbedding(key, taskType, vector)
    return vector
  } catch (error) {
    recordAIUsageEvent({
      feature: 'embeddings',
      provider: ACTIVE_EMBEDDING_PROVIDER,
      model: ACTIVE_EMBEDDING_MODEL,
      operation: 'embedding',
      status: 'failed',
      durationMs: performance.now() - startedAt,
      estimatedInputTokens: Math.ceil(text.length / 4),
      reason: taskType,
      error,
    })
    throw error
  } finally {
    if (embeddingFlights.get(key) === pending) embeddingFlights.delete(key)
  }
}
