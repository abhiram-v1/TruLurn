export const GRAPH_GENERATION_ROUTE_OWNERSHIP = {
  provider: 'gemini',
  model: 'gemini-3.1-pro-preview',
  fallbackProviders: [],
} as const

export const GRAPH_MAINTENANCE_ROUTE_OWNERSHIP = {
  provider: 'openai',
  fallbackProviders: [],
  features: [
    'graph_interaction_analyzer',
    'graph_manager',
    'graph_recommendation',
  ],
} as const
