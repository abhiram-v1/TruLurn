import {
  AI_PROVIDER_NAMES,
  type AIFeature,
  type AIFeatureRoute,
  type AIProviderName,
  type ResolvedAIFeatureRoute,
} from './types.ts'
import {
  COURSE_PLANNING_ROUTE_OWNERSHIP,
  GRAPH_GENERATION_ROUTE_OWNERSHIP,
  GRAPH_MAINTENANCE_ROUTE_OWNERSHIP,
  LESSON_WRITING_ROUTE_OWNERSHIP,
} from './routeOwnership.ts'
import { looksLikeValidModelId } from './modelIdHeuristics.ts'

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

export const AI_MODEL_TIERS = {
  fast: {
    provider: 'gemini',
    models: {
      gemini: 'gemini-3.1-flash-lite',
      openai: 'gpt-5.4-mini',
    },
  },
  control: {
    provider: 'openai',
    models: {
      openai: 'gpt-5.4-mini',
      gemini: 'gemini-3.5-flash',
    },
  },
  premium: {
    provider: 'openai',
    models: {
      openai: 'gpt-5.4',
      gemini: 'gemini-3.5-flash',
    },
  },
} as const

type ModelTier = keyof typeof AI_MODEL_TIERS

const TIER_MODEL_ENVIRONMENT_VARIABLES: Record<
  ModelTier,
  AIFeatureRoute['modelEnvironmentVariables']
> = {
  fast: {
    gemini: ['GEMINI_FAST_MODEL'],
    openai: ['OPENAI_CONTROL_MODEL', 'OPENAI_AGENT_MODEL', 'OPENAI_MINI_MODEL'],
  },
  control: {
    openai: ['OPENAI_CONTROL_MODEL', 'OPENAI_AGENT_MODEL', 'OPENAI_MINI_MODEL'],
    gemini: ['GEMINI_CONTROL_MODEL', 'GEMINI_QUALITY_MODEL'],
  },
  premium: {
    openai: ['OPENAI_PREMIUM_MODEL', 'OPENAI_PRIMARY_MODEL'],
    gemini: ['GEMINI_PREMIUM_MODEL', 'GEMINI_QUALITY_MODEL'],
  },
}

function tierRoute(
  tier: ModelTier,
  purpose: 'primary' | 'agent',
  modelEnvironmentVariables?: AIFeatureRoute['modelEnvironmentVariables'],
): AIFeatureRoute {
  const definition = AI_MODEL_TIERS[tier]
  const tierEnvironment = TIER_MODEL_ENVIRONMENT_VARIABLES[tier]
  return {
    capability: 'text',
    purpose,
    defaultProvider: definition.provider,
    modelEnvironmentVariables: {
      openai: [
        ...(modelEnvironmentVariables?.openai ?? []),
        ...(tierEnvironment?.openai ?? []),
      ],
      gemini: [
        ...(modelEnvironmentVariables?.gemini ?? []),
        ...(tierEnvironment?.gemini ?? []),
      ],
    },
    defaultModels: definition.models,
    // A cross-provider fallback can alter schema and behavior. Enable one only
    // with an explicit AI_FEATURE_*_FALLBACK_PROVIDERS override after evals.
    disableAutomaticFallback: true,
  }
}

const FEATURE_ROUTES: Record<AIFeature, AIFeatureRoute> = {
  agent_action: tierRoute('fast', 'agent'),
  agent_intent: tierRoute('fast', 'agent'),
  agent_style: tierRoute('fast', 'agent'),
  chat_title: tierRoute('fast', 'agent'),
  curriculum_generation: route('primary', {
    openai: ['OPENAI_CURRICULUM_MODEL', 'OPENAI_PRIMARY_MODEL'],
    gemini: ['GEMINI_CURRICULUM_MODEL', 'GEMINI_MODEL'],
  }),
  curriculum_research: {
    capability: 'web_search',
    purpose: 'agent',
    defaultProvider: 'openai',
    modelEnvironmentVariables: {
      openai: ['OPENAI_RESEARCH_MODEL', 'OPENAI_CONTROL_MODEL', 'OPENAI_AGENT_MODEL'],
    },
    defaultModels: { openai: AI_MODEL_TIERS.control.models.openai },
    disableAutomaticFallback: true,
  },
  doubt_answer: tierRoute('premium', 'primary'),
  doubt_classification: tierRoute('fast', 'agent'),
  embeddings: {
    capability: 'embeddings',
    defaultProvider: 'global',
    modelEnvironmentVariables: {
      openai: ['OPENAI_EMBEDDING_MODEL'],
      gemini: ['GEMINI_EMBEDDING_MODEL'],
    },
  },
  exam_evaluation: tierRoute('control', 'agent'),
  exam_question_generation: tierRoute('premium', 'primary'),
  exam_question_validation: tierRoute('control', 'agent'),
  exam_strategy: tierRoute('control', 'agent'),
  flow_tracking: tierRoute('fast', 'agent'),
  graph_interaction_analyzer: route(
    'agent',
    {
      openai: ['OPENAI_GRAPH_ANALYZER_MODEL', 'OPENAI_AGENT_MODEL', 'OPENAI_MINI_MODEL'],
      gemini: ['GEMINI_GRAPH_ANALYZER_MODEL', 'GEMINI_GRAPH_MODEL'],
    },
    { openai: 'gpt-5.4-mini' },
  ),
  graph_generation: {
    capability: 'text',
    purpose: 'primary',
    defaultProvider: GRAPH_GENERATION_ROUTE_OWNERSHIP.provider,
    modelEnvironmentVariables: {
      gemini: ['GEMINI_GRAPH_GENERATION_MODEL'],
    },
    defaultModels: { gemini: GRAPH_GENERATION_ROUTE_OWNERSHIP.model },
    lockedProvider: GRAPH_GENERATION_ROUTE_OWNERSHIP.provider,
    lockedModel: GRAPH_GENERATION_ROUTE_OWNERSHIP.model,
    disableAutomaticFallback: true,
  },
  graph_manager: route(
    'agent',
    {
      openai: ['OPENAI_GRAPH_MANAGER_MODEL', 'OPENAI_AGENT_MODEL', 'OPENAI_MINI_MODEL'],
      gemini: ['GEMINI_GRAPH_MANAGER_MODEL', 'GEMINI_GRAPH_MODEL'],
    },
    { openai: 'gpt-5.4-mini' },
  ),
  graph_recommendation: route(
    'agent',
    {
      openai: ['OPENAI_AGENT_MODEL', 'OPENAI_MINI_MODEL'],
      gemini: ['GEMINI_GRAPH_MODEL'],
    },
    { openai: 'gpt-5.4-mini' },
  ),
  learner_audience: tierRoute('fast', 'agent'),
  lesson_research: {
    capability: 'web_search',
    purpose: 'agent',
    defaultProvider: 'openai',
    modelEnvironmentVariables: {
      openai: ['OPENAI_RESEARCH_MODEL', 'OPENAI_CONTROL_MODEL', 'OPENAI_AGENT_MODEL'],
    },
    defaultModels: { openai: AI_MODEL_TIERS.control.models.openai },
    disableAutomaticFallback: true,
  },
  page_analysis: tierRoute('control', 'agent'),
  prerequisite_gap_analysis: tierRoute('control', 'agent'),
  quiz_generation: tierRoute('premium', 'primary'),
  recall_interruption: {
    ...tierRoute('fast', 'agent', {
      openai: ['OPENAI_INTERRUPTION_MODEL', 'OPENAI_AGENT_MODEL'],
      gemini: ['GEMINI_INTERRUPTION_MODEL'],
    }),
  },
  recall_page_generation: tierRoute('fast', 'primary'),
  source_learning_page: route('primary'),
  source_grounding_verification: tierRoute('control', 'agent', {
    openai: ['OPENAI_GROUNDING_MODEL', 'OPENAI_AGENT_MODEL', 'OPENAI_MINI_MODEL'],
    gemini: ['GEMINI_GROUNDING_MODEL'],
  }),
  source_ordering: {
    ...tierRoute('fast', 'agent', {
      openai: ['OPENAI_SOURCE_ORDER_MODEL', 'OPENAI_AGENT_MODEL', 'OPENAI_MINI_MODEL'],
      gemini: ['GEMINI_SOURCE_ORDER_MODEL'],
    }),
  },
  source_profile: tierRoute('fast', 'agent'),
  topic_page_generation: route('primary', {
    openai: ['OPENAI_LESSON_MODEL', 'OPENAI_PRIMARY_MODEL'],
    gemini: ['GEMINI_LESSON_MODEL', 'GEMINI_MODEL'],
  }),
  topic_plan_analysis: tierRoute('control', 'agent'),
  topic_transform: tierRoute('premium', 'primary'),
  topic_validation: tierRoute('control', 'agent'),
  prompt_enhancement: tierRoute('fast', 'agent'),
  curriculum_ideas: {
    ...tierRoute('fast', 'agent', {
      gemini: ['GEMINI_IDEAS_MODEL'],
    }),
  },
  curriculum_preview: {
    ...tierRoute('fast', 'agent', {
      gemini: ['GEMINI_PREVIEW_MODEL'],
    }),
  },
  // Audits a generated curriculum against the learner's stated goal — cheap,
  // advisory, and non-blocking, so the fast tier is enough.
  goal_coverage_check: tierRoute('fast', 'agent'),
}

for (const feature of COURSE_PLANNING_ROUTE_OWNERSHIP.features) {
  FEATURE_ROUTES[feature] = {
    ...FEATURE_ROUTES[feature],
    defaultProvider: COURSE_PLANNING_ROUTE_OWNERSHIP.provider,
    lockedProvider: COURSE_PLANNING_ROUTE_OWNERSHIP.provider,
    lockedModel: COURSE_PLANNING_ROUTE_OWNERSHIP.model,
    disableAutomaticFallback: true,
  }
}

for (const feature of LESSON_WRITING_ROUTE_OWNERSHIP.features) {
  FEATURE_ROUTES[feature] = {
    ...FEATURE_ROUTES[feature],
    defaultProvider: LESSON_WRITING_ROUTE_OWNERSHIP.provider,
    lockedProvider: LESSON_WRITING_ROUTE_OWNERSHIP.provider,
    lockedModel: LESSON_WRITING_ROUTE_OWNERSHIP.model,
    disableAutomaticFallback: true,
  }
}

for (const feature of GRAPH_MAINTENANCE_ROUTE_OWNERSHIP.features) {
  FEATURE_ROUTES[feature] = {
    ...FEATURE_ROUTES[feature],
    defaultProvider: GRAPH_MAINTENANCE_ROUTE_OWNERSHIP.provider,
    lockedProvider: GRAPH_MAINTENANCE_ROUTE_OWNERSHIP.provider,
    lockedModel: GRAPH_MAINTENANCE_ROUTE_OWNERSHIP.model,
    disableAutomaticFallback: true,
  }
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
  if (definition.lockedModel) return definition.lockedModel
  const modelKey = featureEnvironmentKey(feature, 'MODEL')
  return (includeFeatureOverride ? process.env[modelKey]?.trim() : undefined)
    || firstEnvironmentValue(definition.modelEnvironmentVariables?.[provider])
    || definition.defaultModels?.[provider]
}

export function resolveAIFeatureRoute(feature: AIFeature): ResolvedAIFeatureRoute {
  const definition = FEATURE_ROUTES[feature]
  const providerKey = featureEnvironmentKey(feature, 'PROVIDER')
  const fallbackKey = featureEnvironmentKey(feature, 'FALLBACK_PROVIDERS')
  const configuredProvider = definition.lockedProvider
    ? undefined
    : parseProvider(process.env[providerKey], providerKey)
  const provider = definition.lockedProvider
    ?? configuredProvider
    ?? (definition.defaultProvider === 'global' ? globalProvider() : definition.defaultProvider)
  const configuredFallbacks = definition.lockedProvider
    ? []
    : parseFallbackProviders(process.env[fallbackKey], fallbackKey)

  let fallbackProviders = Array.from(new Set(
    configuredFallbacks ?? (configuredProvider ? [] : definition.fallbackProviders ?? []),
  )).filter((fallback) => fallback !== provider)

  // Auto-fallback default: failover to the alternative provider if no fallbacks are explicitly set
  if (!definition.disableAutomaticFallback && fallbackProviders.length === 0) {
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

// Catches the common misconfiguration of pasting one provider's model id into
// the other provider's environment variable (or a typo'd id). Does not fire
// when no override is configured — falling through to the provider's own
// default is a normal, supported state, not a failure.
export function assertResolvableModel(feature: AIFeature) {
  const route = resolveAIFeatureRoute(feature)
  if (!route.model) return
  if (!looksLikeValidModelId(route.provider, route.model)) {
    throw new Error(
      `AI feature "${feature}" resolved provider "${route.provider}" with model "${route.model}", `
      + `which does not look like a valid ${route.provider} model id. Check the model environment `
      + `variables for this feature (e.g. ${getAIFeatureEnvironmentKeys(feature).model}).`,
    )
  }
}
