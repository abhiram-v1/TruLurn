export const GRAPH_GENERATION_ROUTE_OWNERSHIP = {
  provider: 'gemini',
  // A flash model, not the pro-preview reasoner: graph generation is a bounded
  // mapping task (every node already exists in the approved curriculum) that is
  // checked deterministically by validate.ts afterward, so it does not need a
  // slow "thinking" model. The orchestrator also splits the work into smaller
  // per-branch calls, which a fast model handles well.
  model: 'gemini-3.1-flash-lite',
  fallbackProviders: [],
} as const

export const COURSE_PLANNING_ROUTE_OWNERSHIP = {
  provider: 'openai',
  model: 'gpt-5.4',
  fallbackProviders: [],
  features: [
    'curriculum_preview',
    'curriculum_generation',
    'topic_plan_analysis',
  ],
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
