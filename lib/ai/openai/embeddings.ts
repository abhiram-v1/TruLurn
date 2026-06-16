import { aiFetch } from '@/lib/ai/http'

type OpenAIEmbeddingResponse = {
  data?: Array<{
    embedding?: number[]
  }>
  error?: {
    message?: string
  }
}

const OPENAI_EMBEDDINGS_ENDPOINT = 'https://api.openai.com/v1/embeddings'

export const OPENAI_EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small'

export const OPENAI_EMBEDDING_DIMENSIONS = Number(
  process.env.OPENAI_EMBEDDING_DIMENSIONS ?? 768,
)

export async function embedTextWithOpenAI(
  text: string,
  options: { model?: string; dimensions?: number } = {},
): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY
  const cleanText = text.replace(/\s+/g, ' ').trim()
  const model = options.model ?? OPENAI_EMBEDDING_MODEL
  const dimensions = options.dimensions ?? OPENAI_EMBEDDING_DIMENSIONS

  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY in .env.local')
  }

  if (!cleanText) {
    throw new Error('Cannot embed empty text.')
  }

  const response = await aiFetch(OPENAI_EMBEDDINGS_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: cleanText.slice(0, 16000),
      dimensions,
    }),
  }, { timeoutMs: Number(process.env.AI_EMBED_TIMEOUT_MS ?? 60_000) })

  const data = (await response.json()) as OpenAIEmbeddingResponse

  if (!response.ok) {
    throw new Error(data.error?.message ?? `OpenAI embedding failed with status ${response.status}`)
  }

  const values = data.data?.[0]?.embedding

  if (!values?.length) {
    throw new Error('OpenAI returned an empty embedding.')
  }

  return values
}
