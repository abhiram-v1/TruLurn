import type { AIProviderGenerateInput } from '../types'

function thinkingLevelFor(effort: AIProviderGenerateInput['reasoningEffort']) {
  if (!effort) return null
  if (effort === 'none' || effort === 'minimal') return 'minimal'
  if (effort === 'low') return 'low'
  if (effort === 'medium') return 'medium'
  return 'high'
}

function isGemini3Model(model?: string) {
  return /^gemini-3(?:\.|\b|-)/i.test(model ?? '')
}

function isGemini25Model(model?: string) {
  return /^gemini-2\.5(?:\b|-)/i.test(model ?? '')
}

function thinkingConfigFor(input: Pick<AIProviderGenerateInput, 'model' | 'reasoningEffort'>) {
  const level = thinkingLevelFor(input.reasoningEffort)
  if (!level) return null

  if (isGemini3Model(input.model)) {
    return { thinkingLevel: level }
  }

  if (isGemini25Model(input.model)) {
    if (level === 'minimal') return { thinkingBudget: 0 }
    // Gemini 2.5 accepts -1 as dynamic thinking: the model adjusts reasoning
    // tokens to the request instead of us guessing a fixed budget.
    return { thinkingBudget: -1 }
  }

  return null
}

export function buildGeminiGenerationConfig(input: Pick<
  AIProviderGenerateInput,
  'model' | 'reasoningEffort' | 'responseMimeType' | 'responseSchema'
>) {
  const thinkingConfig = thinkingConfigFor(input)

  return {
    temperature: 0.25,
    topP: 0.9,
    responseMimeType: input.responseSchema ? 'application/json' : (input.responseMimeType ?? 'application/json'),
    ...(input.responseSchema ? { responseJsonSchema: input.responseSchema.schema } : {}),
    ...(thinkingConfig ? { thinkingConfig } : {}),
  }
}
