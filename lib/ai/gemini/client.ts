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
    thoughtsTokenCount?: number
  }
}

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

function buildGeminiBody(input: AIProviderGenerateInput, selectedModel: string) {
  return {
    contents: [{ role: 'user', parts: [{ text: input.user }] }],
    ...(input.system ? { systemInstruction: { parts: [{ text: input.system }] } } : {}),
    generationConfig: buildGeminiGenerationConfig({
      model: selectedModel,
      reasoningEffort: input.reasoningEffort,
      responseMimeType: input.responseMimeType ?? 'application/json',
      responseSchema: input.responseSchema,
    }),
  }
}

export async function generateWithGemini({
  system,
  user,
  model,
  auditFeature,
  onUsage,
  reasoningEffort,
  responseMimeType = 'application/json',
  responseSchema,
  signal,
  timeoutMs,
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
  const response = await aiFetch(`${GEMINI_ENDPOINT}/${selectedModel}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(buildGeminiBody({ system, user, model, auditFeature, onUsage, reasoningEffort, responseMimeType, responseSchema, signal, timeoutMs }, selectedModel)),
  }, { signal, timeoutMs })

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
      thought_tokens: data.usageMetadata.thoughtsTokenCount ?? 0,
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

export async function* streamWithGemini(input: AIProviderGenerateInput): AsyncGenerator<string> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY
  const selectedModel = input.model ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'
  if (!apiKey) throw new Error('Missing GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY in .env.local')

  const response = await aiFetch(`${GEMINI_ENDPOINT}/${selectedModel}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(buildGeminiBody(input, selectedModel)),
  }, { signal: input.signal, timeoutMs: input.timeoutMs })
  if (!response.ok) {
    const data = (await response.json()) as GeminiResponse
    throw new Error(data.error?.message ?? `Gemini stream failed with status ${response.status}`)
  }
  if (!response.body) throw new Error('Gemini stream returned no response body')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const event = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf('\n\n')
      const dataLine = event.split('\n').find((line) => line.startsWith('data:'))
      if (!dataLine) continue
      try {
        const data = JSON.parse(dataLine.slice(5).trim()) as GeminiResponse
        const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text).join('') ?? ''
        if (text) yield text
      } catch {
        // Ignore incomplete/non-text stream events; the next SSE frame is independent.
      }
    }
  }
}
