export { generateAI, generateAIResult, searchAI } from '@/lib/ai/router'
export { parseAIJson } from '@/lib/ai/json'
export {
  resolveAIFeatureRoute,
  resolveAIProviderModel,
  getAIFeatureEnvironmentKeys,
} from '@/lib/ai/routing'
export { getAIProvider, listAIProviders } from '@/lib/ai/providers/registry'
export type {
  AICapability,
  AIFeature,
  AIProviderName,
  AIWebSource,
} from '@/lib/ai/types'
