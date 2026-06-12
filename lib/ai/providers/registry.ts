import { generateWithGemini } from '@/lib/ai/gemini/client'
import { embedText as embedTextWithGemini } from '@/lib/ai/gemini/embeddings'
import {
  generateWithOpenAI,
  generateWithOpenAIWebSearch,
} from '@/lib/ai/openai/client'
import { embedTextWithOpenAI } from '@/lib/ai/openai/embeddings'
import type { AICapability, AIProviderAdapter, AIProviderName } from '@/lib/ai/types'

const providers: Record<AIProviderName, AIProviderAdapter> = {
  gemini: {
    name: 'gemini',
    capabilities: new Set<AICapability>(['text', 'embeddings']),
    isConfigured: () => Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY),
    generate: generateWithGemini,
    embed: ({ text, taskType, model, dimensions }) =>
      embedTextWithGemini(text, taskType, { model, dimensions }),
  },
  openai: {
    name: 'openai',
    capabilities: new Set<AICapability>(['text', 'web_search', 'embeddings']),
    isConfigured: () => Boolean(process.env.OPENAI_API_KEY),
    generate: generateWithOpenAI,
    webSearch: generateWithOpenAIWebSearch,
    embed: ({ text, model, dimensions }) =>
      embedTextWithOpenAI(text, { model, dimensions }),
  },
}

export function getAIProvider(name: AIProviderName) {
  return providers[name]
}

export function listAIProviders() {
  return Object.values(providers)
}
