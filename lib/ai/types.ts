export const AI_PROVIDER_NAMES = ['gemini', 'openai'] as const
export type AIProviderName = (typeof AI_PROVIDER_NAMES)[number]

export type AICapability = 'text' | 'web_search' | 'embeddings'
export type AIPurpose = 'primary' | 'agent'
export type AIReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export type AIResponseSchema = {
  name: string
  schema: Record<string, unknown>
}

export type AIProviderUsage = {
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  totalTokens?: number
}

export type AIProviderGenerateInput = {
  system: string
  user: string
  model?: string
  purpose?: AIPurpose
  /** Internal routing metadata. It never changes the prompt sent to the model. */
  auditFeature?: AIFeature
  /** Stable request-family key used by providers that support prompt caching. */
  promptCacheKey?: string
  onUsage?: (usage: AIProviderUsage) => void
  reasoningEffort?: AIReasoningEffort
  signal?: AbortSignal
  responseMimeType?: 'application/json' | 'text/plain'
  responseSchema?: AIResponseSchema
}

export type AIProviderWebSearchInput = AIProviderGenerateInput & {
  searchContextSize?: 'low' | 'medium' | 'high'
}

export type AIEmbeddingTask =
  | 'SEMANTIC_SIMILARITY'
  | 'RETRIEVAL_DOCUMENT'
  | 'RETRIEVAL_QUERY'
  | 'QUESTION_ANSWERING'

export type AIProviderEmbeddingInput = {
  text: string
  model?: string
  dimensions?: number
  taskType?: AIEmbeddingTask
}

export type AIWebSource = {
  title?: string
  url: string
  domain?: string
}

export type AIWebSearchResult = {
  text: string
  sources: AIWebSource[]
}

export type AIProviderAdapter = {
  name: AIProviderName
  capabilities: ReadonlySet<AICapability>
  isConfigured: () => boolean
  generate?: (input: AIProviderGenerateInput) => Promise<string>
  webSearch?: (input: AIProviderWebSearchInput) => Promise<AIWebSearchResult>
  embed?: (input: AIProviderEmbeddingInput) => Promise<number[]>
}

export type AIFeature =
  | 'agent_action'
  | 'agent_intent'
  | 'agent_style'
  | 'curriculum_generation'
  | 'curriculum_research'
  | 'doubt_answer'
  | 'doubt_classification'
  | 'embeddings'
  | 'exam_evaluation'
  | 'exam_question_generation'
  | 'exam_strategy'
  | 'flow_tracking'
  | 'graph_interaction_analyzer'
  | 'graph_generation'
  | 'graph_manager'
  | 'graph_recommendation'
  | 'learner_audience'
  | 'lesson_research'
  | 'page_analysis'
  | 'prerequisite_gap_analysis'
  | 'quiz_generation'
  | 'recall_interruption'
  | 'recall_page_generation'
  | 'source_learning_page'
  | 'source_grounding_verification'
  | 'source_ordering'
  | 'source_profile'
  | 'topic_page_generation'
  | 'topic_plan_analysis'
  | 'topic_transform'
  | 'topic_validation'
  | 'prompt_enhancement'
  | 'curriculum_ideas'
  | 'curriculum_preview'

export type AIFeatureRoute = {
  capability: AICapability
  purpose?: AIPurpose
  defaultProvider: AIProviderName | 'global'
  fallbackProviders?: AIProviderName[]
  modelEnvironmentVariables?: Partial<Record<AIProviderName, string[]>>
  defaultModels?: Partial<Record<AIProviderName, string>>
  /** Prevent feature-level provider/model overrides for ownership-critical routes. */
  lockedProvider?: AIProviderName
  lockedModel?: string
  /** Prevent the router from adding the alternative provider automatically. */
  disableAutomaticFallback?: boolean
}

export type ResolvedAIFeatureRoute = {
  feature: AIFeature
  capability: AICapability
  purpose?: AIPurpose
  provider: AIProviderName
  fallbackProviders: AIProviderName[]
  model?: string
}
