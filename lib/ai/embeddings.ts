import { embedText as embedTextWithGemini, GEMINI_EMBEDDING_DIMENSIONS } from '@/lib/ai/gemini/embeddings'
import { shouldUseOpenAI } from '@/lib/ai/openai/client'
import {
  embedTextWithOpenAI,
  OPENAI_EMBEDDING_DIMENSIONS,
  OPENAI_EMBEDDING_MODEL,
} from '@/lib/ai/openai/embeddings'

export type EmbeddingTask =
  | 'SEMANTIC_SIMILARITY'
  | 'RETRIEVAL_DOCUMENT'
  | 'RETRIEVAL_QUERY'
  | 'QUESTION_ANSWERING'

export const ACTIVE_EMBEDDING_DIMENSIONS = shouldUseOpenAI()
  ? OPENAI_EMBEDDING_DIMENSIONS
  : GEMINI_EMBEDDING_DIMENSIONS

export const ACTIVE_EMBEDDING_MODEL = shouldUseOpenAI()
  ? OPENAI_EMBEDDING_MODEL
  : process.env.GEMINI_EMBEDDING_MODEL ?? 'gemini-embedding-001'

export async function embedText(
  text: string,
  taskType: EmbeddingTask = 'SEMANTIC_SIMILARITY',
): Promise<number[]> {
  if (shouldUseOpenAI()) {
    return embedTextWithOpenAI(text)
  }

  return embedTextWithGemini(text, taskType)
}
