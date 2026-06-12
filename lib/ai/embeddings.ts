import { getAIProvider } from '@/lib/ai/providers/registry'
import { resolveAIFeatureRoute } from '@/lib/ai/routing'
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

  return provider.embed({
    text,
    taskType,
    model: ACTIVE_EMBEDDING_MODEL,
    dimensions: ACTIVE_EMBEDDING_DIMENSIONS,
  })
}
