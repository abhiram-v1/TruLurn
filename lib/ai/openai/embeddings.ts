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

export async function embedTextWithOpenAI(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY
  const cleanText = text.replace(/\s+/g, ' ').trim()

  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY in .env.local')
  }

  if (!cleanText) {
    throw new Error('Cannot embed empty text.')
  }

  const response = await fetch(OPENAI_EMBEDDINGS_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_EMBEDDING_MODEL,
      input: cleanText.slice(0, 16000),
      dimensions: OPENAI_EMBEDDING_DIMENSIONS,
    }),
  })

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
