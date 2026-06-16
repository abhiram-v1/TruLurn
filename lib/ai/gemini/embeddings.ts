import { aiFetch } from '@/lib/ai/http'
import type { AIEmbeddingTask } from '@/lib/ai/types'

type GeminiEmbeddingResponse = {
  embedding?: {
    values?: number[]
  }
  embeddings?: Array<{
    values?: number[]
  }>
  error?: {
    message?: string
  }
}

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

export const GEMINI_EMBEDDING_MODEL =
  process.env.GEMINI_EMBEDDING_MODEL ?? 'gemini-embedding-001'

export const GEMINI_EMBEDDING_DIMENSIONS = Number(
  process.env.GEMINI_EMBEDDING_DIMENSIONS ?? 768,
)

function normalizeVector(values: number[]) {
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0))
  if (!magnitude) return values
  return values.map((value) => value / magnitude)
}

function formatEmbeddingInput(text: string, taskType: AIEmbeddingTask, model: string) {
  const cleanText = text.replace(/\s+/g, ' ').trim()

  if (!model.includes('embedding-2')) {
    return cleanText
  }

  if (taskType === 'RETRIEVAL_QUERY' || taskType === 'QUESTION_ANSWERING') {
    return `task: question answering | query: ${cleanText}`
  }

  if (taskType === 'RETRIEVAL_DOCUMENT') {
    return `title: TruLurn lesson memory | text: ${cleanText}`
  }

  return `task: sentence similarity | query: ${cleanText}`
}

export async function embedText(
  text: string,
  taskType: AIEmbeddingTask = 'SEMANTIC_SIMILARITY',
  options: { model?: string; dimensions?: number } = {},
): Promise<number[]> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY
  const model = options.model ?? GEMINI_EMBEDDING_MODEL
  const dimensions = options.dimensions ?? GEMINI_EMBEDDING_DIMENSIONS
  const content = formatEmbeddingInput(text, taskType, model)

  if (!apiKey) {
    throw new Error('Missing GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY in .env.local')
  }

  if (!content) {
    throw new Error('Cannot embed empty text.')
  }

  const body: Record<string, unknown> = {
    content: {
      parts: [{ text: content.slice(0, 16000) }],
    },
    output_dimensionality: dimensions,
  }

  if (!model.includes('embedding-2')) {
    body.taskType = taskType
  }

  const response = await aiFetch(`${GEMINI_ENDPOINT}/${model}:embedContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  }, { timeoutMs: Number(process.env.AI_EMBED_TIMEOUT_MS ?? 60_000) })

  const data = (await response.json()) as GeminiEmbeddingResponse

  if (!response.ok) {
    throw new Error(data.error?.message ?? `Gemini embedding failed with status ${response.status}`)
  }

  const values = data.embedding?.values ?? data.embeddings?.[0]?.values

  if (!values?.length) {
    throw new Error('Gemini returned an empty embedding.')
  }

  return model.includes('embedding-2') ? values : normalizeVector(values)
}
