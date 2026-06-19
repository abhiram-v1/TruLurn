import { aiFetch } from '@/lib/ai/http'
import type { AIProviderGenerateInput } from '@/lib/ai/types'
import { buildGeminiGenerationConfig } from '@/lib/ai/gemini/generationConfig'

type GeminiPart = { text: string }

type GeminiContent = {
  role: 'user' | 'model'
  parts: GeminiPart[]
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
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
    cachedContentTokenCount?: number
  }
}

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

export async function generateWithGemini({
  system,
  user,
  model,
  auditFeature,
  onUsage,
  responseMimeType = 'application/json',
  responseSchema,
  signal,
}: AIProviderGenerateInput): Promise<string> {
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

  const response = await aiFetch(`${GEMINI_ENDPOINT}/${selectedModel}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents,
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      generationConfig: buildGeminiGenerationConfig({ responseMimeType, responseSchema }),
    }),
  }, { signal })

  const data = (await response.json()) as GeminiResponse

  if (!response.ok) {
    throw new Error(data.error?.message ?? `Gemini request failed with status ${response.status}`)
  }

  if (process.env.LOG_AI_USAGE === '1' && data.usageMetadata) {
    console.info(JSON.stringify({
      event: 'ai_usage',
      provider: 'gemini',
      feature: auditFeature ?? 'unknown',
      model: selectedModel,
      input_tokens: data.usageMetadata.promptTokenCount ?? 0,
      cached_input_tokens: data.usageMetadata.cachedContentTokenCount ?? 0,
      output_tokens: data.usageMetadata.candidatesTokenCount ?? 0,
      total_tokens: data.usageMetadata.totalTokenCount ?? 0,
    }))
  }
  if (data.usageMetadata) {
    onUsage?.({
      inputTokens: data.usageMetadata.promptTokenCount ?? 0,
      cachedInputTokens: data.usageMetadata.cachedContentTokenCount ?? 0,
      outputTokens: data.usageMetadata.candidatesTokenCount ?? 0,
      totalTokens: data.usageMetadata.totalTokenCount ?? 0,
    })
  }

  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text).join('\n').trim()

  if (!text) {
    throw new Error('Gemini returned an empty response')
  }

  return text
}
