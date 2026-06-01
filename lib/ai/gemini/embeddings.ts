type GeminiEmbeddingTask =
  | 'SEMANTIC_SIMILARITY'
  | 'RETRIEVAL_DOCUMENT'
  | 'RETRIEVAL_QUERY'
  | 'QUESTION_ANSWERING'

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

function formatEmbeddingInput(text: string, taskType: GeminiEmbeddingTask) {
  const cleanText = text.replace(/\s+/g, ' ').trim()

  if (!GEMINI_EMBEDDING_MODEL.includes('embedding-2')) {
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
  taskType: GeminiEmbeddingTask = 'SEMANTIC_SIMILARITY',
): Promise<number[]> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY
  const content = formatEmbeddingInput(text, taskType)

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
    output_dimensionality: GEMINI_EMBEDDING_DIMENSIONS,
  }

  if (!GEMINI_EMBEDDING_MODEL.includes('embedding-2')) {
    body.taskType = taskType
  }

  const response = await fetch(`${GEMINI_ENDPOINT}/${GEMINI_EMBEDDING_MODEL}:embedContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  })

  const data = (await response.json()) as GeminiEmbeddingResponse

  if (!response.ok) {
    throw new Error(data.error?.message ?? `Gemini embedding failed with status ${response.status}`)
  }

  const values = data.embedding?.values ?? data.embeddings?.[0]?.values

  if (!values?.length) {
    throw new Error('Gemini returned an empty embedding.')
  }

  return GEMINI_EMBEDDING_MODEL.includes('embedding-2') ? values : normalizeVector(values)
}
