import { createHash } from 'crypto'
import { getAIProvider } from '@/lib/ai/providers/registry'
import { resolveAIFeatureRoute, resolveAIProviderModel } from '@/lib/ai/routing'
import { recordAIUsageEvent } from '@/lib/ai/usage'
import type {
  AIFeature,
  AIProviderGenerateInput,
  AIProviderName,
  AIProviderUsage,
  AIProviderWebSearchInput,
  AIWebSearchResult,
} from '@/lib/ai/types'

type GenerateAIInput = Omit<
  AIProviderGenerateInput,
  'model' | 'purpose' | 'auditFeature' | 'promptCacheKey' | 'onUsage'
> & {
  feature: AIFeature
  purpose?: AIProviderGenerateInput['purpose']
  validateResponse?: (text: string) => boolean
}

type SearchAIInput = Omit<
  AIProviderWebSearchInput,
  'model' | 'purpose' | 'auditFeature' | 'promptCacheKey' | 'onUsage'
> & {
  feature: AIFeature
  purpose?: AIProviderGenerateInput['purpose']
}

export type AIGenerationResult = {
  text: string
  provider: AIProviderName
  model?: string
}

export type AISearchResult = AIWebSearchResult & {
  provider: AIProviderName
  model?: string
}

function providerSequence(feature: AIFeature) {
  const route = resolveAIFeatureRoute(feature)
  return { route, providers: [route.provider, ...route.fallbackProviders] }
}

function logRoute(feature: AIFeature, provider: AIProviderName, model?: string) {
  if (process.env.LOG_AI_USAGE !== '1') return
  console.info(`[ai-route] feature=${feature} provider=${provider} model=${model ?? 'provider-default'}`)
}

const generationFlights = new Map<string, Promise<AIGenerationResult>>()
const searchFlights = new Map<string, Promise<AISearchResult>>()

function requestHash(kind: 'generate' | 'search', input: GenerateAIInput | SearchAIInput) {
  const schema = 'responseSchema' in input ? input.responseSchema : undefined
  return createHash('sha256')
    .update(JSON.stringify({
      kind,
      feature: input.feature,
      purpose: input.purpose ?? null,
      system: input.system,
      user: input.user,
      responseMimeType: input.responseMimeType ?? null,
      responseSchema: schema ?? null,
      reasoningEffort: input.reasoningEffort ?? null,
      searchContextSize: 'searchContextSize' in input ? input.searchContextSize ?? null : null,
    }))
    .digest('hex')
}

function promptFamilyKey(feature: AIFeature, provider: AIProviderName, model?: string) {
  return `trulurn:${feature}:${provider}:${model ?? 'default'}`
}

function logRequest(input: GenerateAIInput | SearchAIInput) {
  if (process.env.LOG_AI_USAGE !== '1') return
  console.info(JSON.stringify({
    event: 'ai_request',
    feature: input.feature,
    system_chars: input.system.length,
    user_chars: input.user.length,
    estimated_input_tokens: Math.ceil((input.system.length + input.user.length) / 4),
  }))
}

async function singleflight<T>(
  flights: Map<string, Promise<T>>,
  key: string,
  operation: () => Promise<T>,
  feature: AIFeature,
  kind: 'generation' | 'search',
) {
  const existing = flights.get(key)
  if (existing) {
    if (process.env.LOG_AI_USAGE === '1') {
      console.info(JSON.stringify({
        event: 'ai_call_avoided',
        reason: 'singleflight',
        feature,
        kind,
      }))
    }
    recordAIUsageEvent({
      feature,
      operation: kind === 'generation' ? 'generation' : 'search',
      status: 'avoided',
      reason: 'singleflight',
    })
    return existing
  }

  const pending = operation()
  flights.set(key, pending)
  try {
    return await pending
  } finally {
    if (flights.get(key) === pending) flights.delete(key)
  }
}

function assertProvider(feature: AIFeature, providerName: AIProviderName) {
  const route = resolveAIFeatureRoute(feature)
  const provider = getAIProvider(providerName)

  if (!provider.capabilities.has(route.capability)) {
    throw new Error(
      `AI feature "${feature}" requires capability "${route.capability}", but provider "${providerName}" does not support it.`,
    )
  }

  if (!provider.isConfigured()) {
    throw new Error(`AI provider "${providerName}" is selected for feature "${feature}" but is not configured.`)
  }

  return provider
}

function aggregateError(feature: AIFeature, failures: Array<{ provider: AIProviderName; error: unknown }>) {
  const detail = failures
    .map(({ provider, error }) => `${provider}: ${error instanceof Error ? error.message : 'unknown error'}`)
    .join('; ')
  return new Error(`AI feature "${feature}" failed for all configured providers. ${detail}`)
}

async function executeGeneration(input: GenerateAIInput): Promise<AIGenerationResult> {
  const { route, providers } = providerSequence(input.feature)
  const failures: Array<{ provider: AIProviderName; error: unknown }> = []
  const { feature, purpose, validateResponse, ...request } = input

  for (const providerName of providers) {
    const startedAt = performance.now()
    let model: string | undefined
    let usage: AIProviderUsage | undefined
    try {
      const provider = assertProvider(feature, providerName)
      if (!provider.generate) throw new Error(`Provider "${providerName}" has no text generation adapter.`)
      model = providerName === route.provider
        ? route.model
        : resolveAIProviderModel(feature, providerName, false)
      const text = await provider.generate({
        ...request,
        model,
        purpose: purpose ?? route.purpose,
        auditFeature: feature,
        promptCacheKey: promptFamilyKey(feature, providerName, model),
        onUsage: (value) => { usage = value },
      })
      if (validateResponse && !validateResponse(text)) {
        throw new Error(`Provider "${providerName}" returned an invalid response.`)
      }
      logRoute(feature, providerName, model)
      if (process.env.LOG_PERF === '1') {
        console.info(
          `[ai-timing] feature=${feature} provider=${providerName} duration_ms=${Math.round(performance.now() - startedAt)}`,
        )
      }
      recordAIUsageEvent({
        feature,
        provider: providerName,
        model,
        operation: 'generation',
        status: 'succeeded',
        durationMs: performance.now() - startedAt,
        systemChars: request.system.length,
        userChars: request.user.length,
        estimatedInputTokens: Math.ceil((request.system.length + request.user.length) / 4),
        usage,
      })
      return { text, provider: providerName, model }
    } catch (error) {
      if (process.env.LOG_PERF === '1') {
        console.warn(
          `[ai-timing] feature=${feature} provider=${providerName} failed_ms=${Math.round(performance.now() - startedAt)}`,
        )
      }
      recordAIUsageEvent({
        feature,
        provider: providerName,
        model,
        operation: 'generation',
        status: 'failed',
        durationMs: performance.now() - startedAt,
        systemChars: request.system.length,
        userChars: request.user.length,
        estimatedInputTokens: Math.ceil((request.system.length + request.user.length) / 4),
        usage,
        error,
      })
      if (request.signal?.aborted) throw error
      failures.push({ provider: providerName, error })
    }
  }

  throw aggregateError(feature, failures)
}

export async function generateAIResult(input: GenerateAIInput): Promise<AIGenerationResult> {
  logRequest(input)
  if (
    input.signal
    || input.validateResponse
    || process.env.AI_SINGLEFLIGHT_DISABLED === '1'
  ) {
    return executeGeneration(input)
  }
  return singleflight(
    generationFlights,
    requestHash('generate', input),
    () => executeGeneration(input),
    input.feature,
    'generation',
  )
}

export async function generateAI(input: GenerateAIInput) {
  return (await generateAIResult(input)).text
}

async function executeSearch(input: SearchAIInput): Promise<AISearchResult> {
  const { route, providers } = providerSequence(input.feature)
  const failures: Array<{ provider: AIProviderName; error: unknown }> = []
  const { feature, purpose, ...request } = input

  for (const providerName of providers) {
    const startedAt = performance.now()
    let model: string | undefined
    let usage: AIProviderUsage | undefined
    try {
      const provider = assertProvider(feature, providerName)
      if (!provider.webSearch) throw new Error(`Provider "${providerName}" has no web search adapter.`)
      model = providerName === route.provider
        ? route.model
        : resolveAIProviderModel(feature, providerName, false)
      const result = await provider.webSearch({
        ...request,
        model,
        purpose: purpose ?? route.purpose,
        auditFeature: feature,
        promptCacheKey: promptFamilyKey(feature, providerName, model),
        onUsage: (value) => { usage = value },
      })
      logRoute(feature, providerName, model)
      recordAIUsageEvent({
        feature,
        provider: providerName,
        model,
        operation: 'search',
        status: 'succeeded',
        durationMs: performance.now() - startedAt,
        systemChars: request.system.length,
        userChars: request.user.length,
        estimatedInputTokens: Math.ceil((request.system.length + request.user.length) / 4),
        usage,
      })
      return { ...result, provider: providerName, model }
    } catch (error) {
      recordAIUsageEvent({
        feature,
        provider: providerName,
        model,
        operation: 'search',
        status: 'failed',
        durationMs: performance.now() - startedAt,
        systemChars: request.system.length,
        userChars: request.user.length,
        estimatedInputTokens: Math.ceil((request.system.length + request.user.length) / 4),
        usage,
        error,
      })
      if (request.signal?.aborted) throw error
      failures.push({ provider: providerName, error })
    }
  }

  throw aggregateError(feature, failures)
}

export async function searchAI(input: SearchAIInput): Promise<AISearchResult> {
  logRequest(input)
  if (input.signal || process.env.AI_SINGLEFLIGHT_DISABLED === '1') {
    return executeSearch(input)
  }
  return singleflight(
    searchFlights,
    requestHash('search', input),
    () => executeSearch(input),
    input.feature,
    'search',
  )
}
