import { getAIProvider } from '@/lib/ai/providers/registry'
import { resolveAIFeatureRoute, resolveAIProviderModel } from '@/lib/ai/routing'
import type {
  AIFeature,
  AIProviderGenerateInput,
  AIProviderName,
  AIProviderWebSearchInput,
  AIWebSearchResult,
} from '@/lib/ai/types'

type GenerateAIInput = Omit<AIProviderGenerateInput, 'model' | 'purpose'> & {
  feature: AIFeature
  purpose?: AIProviderGenerateInput['purpose']
  validateResponse?: (text: string) => boolean
}

type SearchAIInput = Omit<AIProviderWebSearchInput, 'model' | 'purpose'> & {
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

export async function generateAIResult(input: GenerateAIInput): Promise<AIGenerationResult> {
  const { route, providers } = providerSequence(input.feature)
  const failures: Array<{ provider: AIProviderName; error: unknown }> = []
  const { feature, purpose, validateResponse, ...request } = input

  for (const providerName of providers) {
    try {
      const provider = assertProvider(feature, providerName)
      if (!provider.generate) throw new Error(`Provider "${providerName}" has no text generation adapter.`)
      const model = providerName === route.provider
        ? route.model
        : resolveAIProviderModel(feature, providerName, false)
      const text = await provider.generate({
        ...request,
        model,
        purpose: purpose ?? route.purpose,
      })
      if (validateResponse && !validateResponse(text)) {
        throw new Error(`Provider "${providerName}" returned an invalid response.`)
      }
      logRoute(feature, providerName, model)
      return { text, provider: providerName, model }
    } catch (error) {
      if (request.signal?.aborted) throw error
      failures.push({ provider: providerName, error })
    }
  }

  throw aggregateError(feature, failures)
}

export async function generateAI(input: GenerateAIInput) {
  return (await generateAIResult(input)).text
}

export async function searchAI(input: SearchAIInput): Promise<AISearchResult> {
  const { route, providers } = providerSequence(input.feature)
  const failures: Array<{ provider: AIProviderName; error: unknown }> = []
  const { feature, purpose, ...request } = input

  for (const providerName of providers) {
    try {
      const provider = assertProvider(feature, providerName)
      if (!provider.webSearch) throw new Error(`Provider "${providerName}" has no web search adapter.`)
      const model = providerName === route.provider
        ? route.model
        : resolveAIProviderModel(feature, providerName, false)
      const result = await provider.webSearch({
        ...request,
        model,
        purpose: purpose ?? route.purpose,
      })
      logRoute(feature, providerName, model)
      return { ...result, provider: providerName, model }
    } catch (error) {
      if (request.signal?.aborted) throw error
      failures.push({ provider: providerName, error })
    }
  }

  throw aggregateError(feature, failures)
}
