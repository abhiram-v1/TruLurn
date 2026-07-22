import { createHash } from 'crypto'
import { aiFetch } from '@/lib/ai/http'
import type { AIProviderUsage } from '@/lib/ai/types'

type OpenAIGenerateInput = {
  system: string
  user: string
  model?: string
  purpose?: 'primary' | 'agent'
  auditFeature?: string
  promptCacheKey?: string
  onUsage?: (usage: AIProviderUsage) => void
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  signal?: AbortSignal
  timeoutMs?: number
  responseMimeType?: 'application/json' | 'text/plain'
  // When provided, uses json_schema structured output instead of json_object mode.
  // Only `strict: true` actually constrains decoding to the schema; `strict: false`
  // (the default) is a hint with the same reliability as json_object mode.
  responseSchema?: {
    name: string
    schema: Record<string, unknown>
    strict?: boolean
  }
}

type OpenAIWebSearchInput = OpenAIGenerateInput & {
  searchContextSize?: 'low' | 'medium' | 'high'
}

type OpenAIResponse = {
  output_text?: string
  output?: Array<{
    type?: string
    content?: Array<{
      annotations?: Array<Record<string, unknown>>
      text?: string
      type?: string
    }>
    action?: {
      sources?: Array<Record<string, unknown>>
    }
  }>
  usage?: {
    input_tokens?: number
    output_tokens?: number
    input_tokens_details?: { cached_tokens?: number }
  }
  error?: {
    message?: string
  }
}

// Stable cache key per distinct system prompt — groups same-prefix requests so
// OpenAI routes matching prompt families to the same cache shard, improving the
// hit rate without changing the prompt content sent to the model.
function promptCacheKey(seed: string) {
  return `tl_${createHash('sha1').update(seed).digest('hex').slice(0, 24)}`
}

// Log prompt-cache effectiveness so caching is observable. Set LOG_AI_USAGE=1 to enable.
function logOpenAIUsage(model: string, data: OpenAIResponse, input: OpenAIGenerateInput) {
  if (process.env.LOG_AI_USAGE !== '1' || !data.usage) return
  const inputTokens = data.usage.input_tokens ?? 0
  const cached = data.usage.input_tokens_details?.cached_tokens ?? 0
  const pct = inputTokens > 0 ? Math.round((cached / inputTokens) * 100) : 0
  console.info(JSON.stringify({
    event: 'ai_usage',
    provider: 'openai',
    feature: input.auditFeature ?? 'unknown',
    model,
    input_tokens: inputTokens,
    cached_input_tokens: cached,
    cache_hit_percent: pct,
    output_tokens: data.usage.output_tokens ?? 0,
  }))
}

function reportOpenAIUsage(data: OpenAIResponse, input: OpenAIGenerateInput) {
  if (!data.usage) return
  input.onUsage?.({
    inputTokens: data.usage.input_tokens ?? 0,
    cachedInputTokens: data.usage.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: data.usage.output_tokens ?? 0,
    totalTokens: (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0),
  })
}

export type OpenAIWebSource = {
  title?: string
  url: string
  domain?: string
}

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/responses'

function selectOpenAIModel(input: OpenAIGenerateInput) {
  const explicitOpenAIModel = input.model && /^(gpt|o\d|chatgpt)/i.test(input.model)
    ? input.model
    : null

  if (explicitOpenAIModel) return explicitOpenAIModel

  if (input.purpose === 'agent') {
    return process.env.OPENAI_AGENT_MODEL
      ?? process.env.OPENAI_MINI_MODEL
      ?? 'gpt-5.4-mini'
  }

  return process.env.OPENAI_PRIMARY_MODEL
    ?? process.env.OPENAI_LESSON_MODEL
    ?? 'gpt-5.4'
}

function extractOutputText(data: OpenAIResponse) {
  if (data.output_text?.trim()) return data.output_text.trim()

  const text = data.output
    ?.flatMap((item) => item.content ?? [])
    .map((content) => content.text ?? '')
    .join('\n')
    .trim()

  return text ?? ''
}

function sourceFromValue(value: Record<string, unknown>): OpenAIWebSource | null {
  const url = typeof value.url === 'string' ? value.url : null
  if (!url) return null

  let domain: string | undefined
  try {
    domain = new URL(url).hostname.replace(/^www\./, '')
  } catch {
    domain = undefined
  }

  return {
    url,
    title: typeof value.title === 'string' ? value.title : undefined,
    domain,
  }
}

function collectSources(value: unknown, out: Map<string, OpenAIWebSource>) {
  if (!value || typeof value !== 'object') return

  if (Array.isArray(value)) {
    value.forEach((item) => collectSources(item, out))
    return
  }

  const record = value as Record<string, unknown>
  const source = sourceFromValue(record)
  if (source && !out.has(source.url)) {
    out.set(source.url, source)
  }

  Object.values(record).forEach((item) => collectSources(item, out))
}

function extractWebSources(data: OpenAIResponse): OpenAIWebSource[] {
  const sources = new Map<string, OpenAIWebSource>()
  collectSources(data.output ?? [], sources)
  return Array.from(sources.values())
}

function buildOpenAIRequestBody(input: OpenAIGenerateInput, model: string, stream = false) {
  const body: Record<string, unknown> = {
    model,
    input: [
      { role: 'system', content: input.system },
      { role: 'user', content: input.user },
    ],
    prompt_cache_key: promptCacheKey(input.promptCacheKey ?? input.system),
    ...(stream ? { stream: true } : {}),
  }

  if (input.responseSchema) {
    body.text = {
      format: {
        type: 'json_schema',
        name: input.responseSchema.name,
        schema: input.responseSchema.schema,
        strict: input.responseSchema.strict ?? false,
      },
    }
  } else if (input.responseMimeType === 'application/json') {
    body.text = { format: { type: 'json_object' } }
  }
  if (input.reasoningEffort) body.reasoning = { effort: input.reasoningEffort }
  return body
}

export async function generateWithOpenAI(input: OpenAIGenerateInput): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY in .env.local')
  }

  const model = selectOpenAIModel(input)
  const body = buildOpenAIRequestBody(input, model)

  const response = await aiFetch(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }, { signal: input.signal, timeoutMs: input.timeoutMs })

  const data = (await response.json()) as OpenAIResponse

  if (!response.ok) {
    throw new Error(data.error?.message ?? `OpenAI request failed with status ${response.status}`)
  }

  logOpenAIUsage(model, data, input)
  reportOpenAIUsage(data, input)

  const text = extractOutputText(data)

  if (!text) {
    throw new Error('OpenAI returned an empty response')
  }

  return text
}

/** Stream Responses API output text deltas as they are generated. */
export async function* streamWithOpenAI(input: OpenAIGenerateInput): AsyncGenerator<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY in .env.local')

  const model = selectOpenAIModel(input)
  const response = await aiFetch(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildOpenAIRequestBody(input, model, true)),
  }, { signal: input.signal, timeoutMs: input.timeoutMs })

  if (!response.ok) {
    const data = (await response.json()) as OpenAIResponse
    throw new Error(data.error?.message ?? `OpenAI stream failed with status ${response.status}`)
  }
  if (!response.body) throw new Error('OpenAI stream returned no response body')

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
        const payload = JSON.parse(dataLine.slice(5).trim()) as { type?: string; delta?: string; error?: { message?: string } }
        if (payload.type === 'response.output_text.delta' && typeof payload.delta === 'string') {
          yield payload.delta
        }
        if (payload.type === 'error') throw new Error(payload.error?.message ?? 'OpenAI streaming error')
      } catch (error) {
        if (error instanceof SyntaxError) continue
        throw error
      }
    }
  }
}

export async function generateWithOpenAIWebSearch(input: OpenAIWebSearchInput): Promise<{
  text: string
  sources: OpenAIWebSource[]
}> {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY in .env.local')
  }

  const model = input.model ?? process.env.OPENAI_RESEARCH_MODEL ?? selectOpenAIModel(input)
  async function send(toolType: 'web_search' | 'web_search_preview') {
    const body: Record<string, unknown> = {
      model,
      input: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
      tools: [
        {
          type: toolType,
          search_context_size: input.searchContextSize ?? 'medium',
        },
      ],
      tool_choice: { type: toolType },
      prompt_cache_key: promptCacheKey(input.promptCacheKey ?? input.system),
    }

    // JSON mode (response_format: json_object) is incompatible with web search tools —
    // OpenAI rejects requests that combine both. The prompt already instructs the model
    // to return JSON, so the shared JSON parser handles the output without format enforcement.

    // Web search runs a tool loop (search + synthesis), so it legitimately takes
    // longer than a plain completion — give it a wider ceiling.
    const response = await aiFetch(OPENAI_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }, { signal: input.signal, timeoutMs: Number(process.env.AI_SEARCH_TIMEOUT_MS ?? 180_000) })

    const data = (await response.json()) as OpenAIResponse
    return { response, data }
  }

  let { response, data } = await send('web_search')

  if (!response.ok && /web_search/i.test(data.error?.message ?? '')) {
    const fallback = await send('web_search_preview')
    response = fallback.response
    data = fallback.data
  }

  if (!response.ok) {
    throw new Error(data.error?.message ?? `OpenAI web search request failed with status ${response.status}`)
  }

  logOpenAIUsage(model, data, input)
  reportOpenAIUsage(data, input)

  const text = extractOutputText(data)

  if (!text) {
    throw new Error('OpenAI web search returned an empty response')
  }

  return {
    text,
    sources: extractWebSources(data),
  }
}
