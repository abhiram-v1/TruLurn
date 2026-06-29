import type { AIProviderName } from '@/lib/ai/types'

const PROVIDER_MODEL_ID_PATTERNS: Record<AIProviderName, RegExp> = {
  gemini: /^gemini-/i,
  openai: /^(gpt-|o\d|chatgpt)/i,
}

// Returns true if `model` looks like a plausible id for `provider`. Used to
// catch the common misconfiguration of pasting one provider's model id into
// the other provider's environment variable (or a typo'd id). Not a guarantee
// the model actually exists — only the API can confirm that.
export function looksLikeValidModelId(provider: AIProviderName, model: string): boolean {
  return PROVIDER_MODEL_ID_PATTERNS[provider].test(model)
}
