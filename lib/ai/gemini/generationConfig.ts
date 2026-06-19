import type { AIProviderGenerateInput } from '../types'

export function buildGeminiGenerationConfig(input: Pick<
  AIProviderGenerateInput,
  'responseMimeType' | 'responseSchema'
>) {
  return {
    temperature: 0.25,
    topP: 0.9,
    responseMimeType: input.responseSchema ? 'application/json' : (input.responseMimeType ?? 'application/json'),
    ...(input.responseSchema ? { responseJsonSchema: input.responseSchema.schema } : {}),
  }
}
