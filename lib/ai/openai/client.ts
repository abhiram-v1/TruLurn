type OpenAIGenerateInput = {
  system: string
  user: string
  model?: string
  purpose?: 'primary' | 'agent'
  responseMimeType?: 'application/json' | 'text/plain'
}

type OpenAIResponse = {
  output_text?: string
  output?: Array<{
    content?: Array<{
      text?: string
      type?: string
    }>
  }>
  error?: {
    message?: string
  }
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

export function shouldUseOpenAI() {
  const provider = process.env.AI_PROVIDER?.toLowerCase()
  if (provider === 'gemini') return false
  if (provider === 'openai') return true
  return Boolean(process.env.OPENAI_API_KEY)
}

export async function generateWithOpenAI(input: OpenAIGenerateInput): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY in .env.local')
  }

  const body: Record<string, unknown> = {
    model: selectOpenAIModel(input),
    input: [
      { role: 'system', content: input.system },
      { role: 'user', content: input.user },
    ],
  }

  if (input.responseMimeType === 'application/json') {
    body.text = {
      format: {
        type: 'json_object',
      },
    }
  }

  const response = await fetch(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const data = (await response.json()) as OpenAIResponse

  if (!response.ok) {
    throw new Error(data.error?.message ?? `OpenAI request failed with status ${response.status}`)
  }

  const text = extractOutputText(data)

  if (!text) {
    throw new Error('OpenAI returned an empty response')
  }

  return text
}
