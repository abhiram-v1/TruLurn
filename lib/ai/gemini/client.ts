import { generateWithOpenAI, shouldUseOpenAI } from '@/lib/ai/openai/client'

type GeminiPart = { text: string }

type GeminiContent = {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

type GeminiGenerateInput = {
  system: string
  user: string
  model?: string
  purpose?: 'primary' | 'agent'
  responseMimeType?: 'application/json' | 'text/plain'
}

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[]
    }
  }>
  error?: {
    message?: string
  }
}

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

export async function generateWithGemini({
  system,
  user,
  model,
  purpose,
  responseMimeType = 'application/json',
}: GeminiGenerateInput): Promise<string> {
  if (shouldUseOpenAI()) {
    return generateWithOpenAI({ system, user, model, purpose, responseMimeType })
  }

  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY
  const selectedModel = model ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'

  if (!apiKey) {
    throw new Error('Missing GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY in .env.local')
  }

  const contents: GeminiContent[] = [
    {
      role: 'user',
      parts: [{ text: `${system}\n\n${user}` }],
    },
  ]

  const response = await fetch(`${GEMINI_ENDPOINT}/${selectedModel}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents,
      generationConfig: {
        temperature: 0.25,
        topP: 0.9,
        responseMimeType,
      },
    }),
  })

  const data = (await response.json()) as GeminiResponse

  if (!response.ok) {
    throw new Error(data.error?.message ?? `Gemini request failed with status ${response.status}`)
  }

  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text).join('\n').trim()

  if (!text) {
    throw new Error('Gemini returned an empty response')
  }

  return text
}
