import {
  AI_PROVIDER_NAMES,
  type AIFeature,
  type AIFeatureRoute,
  type AIProviderName,
  type ResolvedAIFeatureRoute,
} from '@/lib/ai/types'

function route(
  purpose: 'primary' | 'agent',
  modelEnvironmentVariables?: AIFeatureRoute['modelEnvironmentVariables'],
  defaultModels?: AIFeatureRoute['defaultModels'],
): AIFeatureRoute {
  return {
    capability: 'text',
    purpose,
    defaultProvider: 'global',
    modelEnvironmentVariables,
    defaultModels,
  }
}

const FEATURE_ROUTES: Record<AIFeature, AIFeatureRoute> = {
  agent_action: route('agent'),
  agent_intent: route('agent'),
  agent_style: route('agent'),
  curriculum_generation: route('primary', {
    openai: ['OPENAI_CURRICULUM_MODEL', 'OPENAI_PRIMARY_MODEL'],
    gemini: ['GEMINI_CURRICULUM_MODEL', 'GEMINI_MODEL'],
  }),
  curriculum_research: {
    capability: 'web_search',
    purpose: 'primary',
    defaultProvider: 'openai',
    modelEnvironmentVariables: { openai: ['OPENAI_RESEARCH_MODEL'] },
  },
  doubt_answer: route('primary'),
  doubt_classification: route('agent'),
  embeddings: {
    capability: 'embeddings',
    defaultProvider: 'global',
    modelEnvironmentVariables: {
      openai: ['OPENAI_EMBEDDING_MODEL'],
      gemini: ['GEMINI_EMBEDDING_MODEL'],
    },
  },
  exam_evaluation: route('agent'),
  exam_question_generation: route('primary'),
  exam_strategy: route('agent'),
  flow_tracking: route('agent'),
  graph_recommendation: route(
    'agent',
    {
      openai: ['OPENAI_AGENT_MODEL', 'OPENAI_MINI_MODEL'],
      gemini: ['GEMINI_GRAPH_MODEL'],
    },
    { gemini: 'gemini-2.5-flash-lite' },
  ),
  learner_audience: route('agent'),
  lesson_research: {
    capability: 'web_search',
    purpose: 'agent',
    defaultProvider: 'openai',
    modelEnvironmentVariables: { openai: ['OPENAI_RESEARCH_MODEL', 'OPENAI_AGENT_MODEL'] },
  },
  map_generation: route('primary', {
    openai: ['OPENAI_MAP_MODEL', 'OPENAI_PRIMARY_MODEL'],
    gemini: ['GEMINI_MAP_MODEL', 'GEMINI_MODEL'],
  }),
  page_analysis: route('agent'),
  prerequisite_gap_analysis: route('agent'),
  quiz_generation: route('primary'),
  recall_interruption: {
    ...route('agent', {
      openai: ['OPENAI_INTERRUPTION_MODEL', 'OPENAI_AGENT_MODEL'],
      gemini: ['GEMINI_INTERRUPTION_MODEL', 'GEMINI_MODEL'],
    }),
    defaultProvider: 'gemini',
  },
  recall_page_generation: route('primary'),
  source_learning_page: route('primary'),
  source_grounding_verification: route('agent', {
    openai: ['OPENAI_GROUNDING_MODEL', 'OPENAI_AGENT_MODEL', 'OPENAI_MINI_MODEL'],
    gemini: ['GEMINI_GROUNDING_MODEL', 'GEMINI_MODEL'],
  }),
  source_ordering: {
    ...route('agent', {
      openai: ['OPENAI_SOURCE_ORDER_MODEL', 'OPENAI_AGENT_MODEL', 'OPENAI_MINI_MODEL'],
      gemini: ['GEMINI_SOURCE_ORDER_MODEL', 'GEMINI_MODEL'],
    }),
    defaultProvider: 'gemini',
    fallbackProviders: ['openai'],
  },
  source_profile: route('agent'),
  topic_page_generation: route('primary', {
    openai: ['OPENAI_LESSON_MODEL', 'OPENAI_PRIMARY_MODEL'],
    gemini: ['GEMINI_LESSON_MODEL', 'GEMINI_MODEL'],
  }),
  topic_plan_analysis: route('agent'),
  topic_transform: route('primary'),
  topic_validation: route('agent'),
}

function parseProvider(value: string | undefined, key: string): AIProviderName | undefined {
  if (!value?.trim()) return undefined
  const provider = value.trim().toLowerCase()
  if (AI_PROVIDER_NAMES.includes(provider as AIProviderName)) return provider as AIProviderName
  throw new Error(`${key} must be one of: ${AI_PROVIDER_NAMES.join(', ')}. Received "${value}".`)
}

function featureEnvironmentKey(feature: AIFeature, suffix: string) {
  return `AI_FEATURE_${feature.toUpperCase()}_${suffix}`
}

function globalProvider() {
  const configured = parseProvider(process.env.AI_PROVIDER, 'AI_PROVIDER')
  if (configured) return configured
  return process.env.OPENAI_API_KEY ? 'openai' : 'gemini'
}

function firstEnvironmentValue(keys: string[] | undefined) {
  for (const key of keys ?? []) {
    const value = process.env[key]?.trim()
    if (value) return value
  }
  return undefined
}

function parseFallbackProviders(value: string | undefined, key: string) {
  if (!value?.trim()) return undefined
  return value
    .split(',')
    .map((provider) => parseProvider(provider, key))
    .filter((provider): provider is AIProviderName => Boolean(provider))
}

export function resolveAIProviderModel(
  feature: AIFeature,
  provider: AIProviderName,
  includeFeatureOverride = true,
) {
  const definition = FEATURE_ROUTES[feature]
  const modelKey = featureEnvironmentKey(feature, 'MODEL')
  return (includeFeatureOverride ? process.env[modelKey]?.trim() : undefined)
    || firstEnvironmentValue(definition.modelEnvironmentVariables?.[provider])
    || definition.defaultModels?.[provider]
}

export function resolveAIFeatureRoute(feature: AIFeature): ResolvedAIFeatureRoute {
  const definition = FEATURE_ROUTES[feature]
  const providerKey = featureEnvironmentKey(feature, 'PROVIDER')
  const fallbackKey = featureEnvironmentKey(feature, 'FALLBACK_PROVIDERS')
  const configuredProvider = parseProvider(process.env[providerKey], providerKey)
  const provider = configuredProvider
    ?? (definition.defaultProvider === 'global' ? globalProvider() : definition.defaultProvider)
  const configuredFallbacks = parseFallbackProviders(process.env[fallbackKey], fallbackKey)

  let fallbackProviders = Array.from(new Set(
    configuredFallbacks ?? (configuredProvider ? [] : definition.fallbackProviders ?? []),
  )).filter((fallback) => fallback !== provider)

  // Auto-fallback default: failover to the alternative provider if no fallbacks are explicitly set
  if (fallbackProviders.length === 0) {
    if (provider === 'openai') {
      fallbackProviders = ['gemini']
    } else if (provider === 'gemini') {
      fallbackProviders = ['openai']
    }
  }

  const model = resolveAIProviderModel(feature, provider)

  return {
    feature,
    capability: definition.capability,
    purpose: definition.purpose,
    provider,
    fallbackProviders,
    model,
  }
}

export function getAIFeatureEnvironmentKeys(feature: AIFeature) {
  return {
    provider: featureEnvironmentKey(feature, 'PROVIDER'),
    fallbackProviders: featureEnvironmentKey(feature, 'FALLBACK_PROVIDERS'),
    model: featureEnvironmentKey(feature, 'MODEL'),
  }
}
