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
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  signal?: AbortSignal
  forceGemini?: boolean
  responseMimeType?: 'application/json' | 'text/plain'
  responseSchema?: {
    name: string
    schema: Record<string, unknown>
  }
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
  forceGemini = false,
  responseMimeType = 'application/json',
  responseSchema,
  reasoningEffort,
  signal,
}: GeminiGenerateInput): Promise<string> {
  if (!forceGemini && shouldUseOpenAI()) {
    return generateWithOpenAI({
      system,
      user,
      model,
      purpose,
      reasoningEffort,
      signal,
      responseMimeType,
      responseSchema,
    })
  }

  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY
  const selectedModel = model ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'

  if (!apiKey) {
    throw new Error('Missing GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY in .env.local')
  }

  // Send the (static) system prompt as a dedicated systemInstruction rather than
  // merging it into the user turn. This is the correct Gemini pattern AND it makes
  // the large, unchanging instruction block a stable cacheable prefix — Gemini 2.5
  // implicit caching then discounts it on every repeat call for the same config.
  const contents: GeminiContent[] = [
    {
      role: 'user',
      parts: [{ text: user }],
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
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      generationConfig: {
        temperature: 0.25,
        topP: 0.9,
        responseMimeType,
      },
    }),
    signal,
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
