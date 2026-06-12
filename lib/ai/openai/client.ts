import { createHash } from 'crypto'

type OpenAIGenerateInput = {
  system: string
  user: string
  model?: string
  purpose?: 'primary' | 'agent'
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  signal?: AbortSignal
  responseMimeType?: 'application/json' | 'text/plain'
  // When provided, uses json_schema structured output instead of json_object mode.
  // More reliable than json_object — enforces exact shape regardless of prompt length.
  responseSchema?: {
    name: string
    schema: Record<string, unknown>
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
// OpenAI routes them to the same prompt cache, improving the hit rate on top of
// the automatic prefix caching. Different prompt families (writer, planner,
// graph, quiz) hash to different keys automatically.
function promptCacheKey(system: string) {
  return `tl_${createHash('sha1').update(system).digest('hex').slice(0, 24)}`
}

// Log prompt-cache effectiveness so caching is observable. Set LOG_AI_USAGE=1 to enable.
function logOpenAIUsage(model: string, data: OpenAIResponse) {
  if (process.env.LOG_AI_USAGE !== '1' || !data.usage) return
  const input = data.usage.input_tokens ?? 0
  const cached = data.usage.input_tokens_details?.cached_tokens ?? 0
  const pct = input > 0 ? Math.round((cached / input) * 100) : 0
  console.info(`[ai] ${model} input=${input} cached=${cached} (${pct}%) output=${data.usage.output_tokens ?? 0}`)
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

export async function generateWithOpenAI(input: OpenAIGenerateInput): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY in .env.local')
  }

  const model = selectOpenAIModel(input)
  const body: Record<string, unknown> = {
    model,
    input: [
      { role: 'system', content: input.system },
      { role: 'user', content: input.user },
    ],
    prompt_cache_key: promptCacheKey(input.system),
  }

  if (input.responseSchema) {
    // json_schema mode: hard-enforces the exact response shape. More reliable than
    // json_object for long prompts or models that don't follow format instructions well.
    body.text = {
      format: {
        type: 'json_schema',
        name: input.responseSchema.name,
        schema: input.responseSchema.schema,
        strict: false, // strict=true requires all fields, false allows optional nullable fields
      },
    }
  } else if (input.responseMimeType === 'application/json') {
    body.text = {
      format: {
        type: 'json_object',
      },
    }
  }
  if (input.reasoningEffort) {
    body.reasoning = { effort: input.reasoningEffort }
  }

  const response = await fetch(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: input.signal,
  })

  const data = (await response.json()) as OpenAIResponse

  if (!response.ok) {
    throw new Error(data.error?.message ?? `OpenAI request failed with status ${response.status}`)
  }

  logOpenAIUsage(model, data)

  const text = extractOutputText(data)

  if (!text) {
    throw new Error('OpenAI returned an empty response')
  }

  return text
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
      prompt_cache_key: promptCacheKey(input.system),
    }

    // JSON mode (response_format: json_object) is incompatible with web search tools —
    // OpenAI rejects requests that combine both. The prompt already instructs the model
    // to return JSON, so the shared JSON parser handles the output without format enforcement.

    const response = await fetch(OPENAI_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

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

  logOpenAIUsage(model, data)

  const text = extractOutputText(data)

  if (!text) {
    throw new Error('OpenAI web search returned an empty response')
  }

  return {
    text,
    sources: extractWebSources(data),
  }
}
