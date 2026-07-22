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

// Course structure planning: the curriculum itself, its preview, and analysis
// of the topic plan. Content-heavy reasoning about pedagogy and structure —
// locked to GPT-5.5 so provider/model env overrides can't quietly weaken it.
export const COURSE_PLANNING_ROUTE_OWNERSHIP = {
  provider: 'openai',
  model: 'gpt-5.5',
  fallbackProviders: [],
  features: [
    'curriculum_preview',
    'curriculum_generation',
    'topic_plan_analysis',
  ],
} as const

// Individual lesson-page writing: the actual prose the student reads. Same
// reasoning as course planning (content-heavy, needs strong pedagogical
// reasoning and consistent educational structure) but locked separately —
// this runs per-page at course-build scale, a much higher call volume than
// the one-shot curriculum plan, so it can be retuned independently later.
export const LESSON_WRITING_ROUTE_OWNERSHIP = {
  provider: 'openai',
  model: 'gpt-5.5',
  fallbackProviders: [],
  features: [
    'topic_page_generation',
  ],
} as const

// Graph-related generation and upkeep — the knowledge graph / roadmap map
// (nodes, edges, interaction analysis, maintenance recommendations) — runs
// exclusively on Gemini. These are bounded tasks whose output is checked
// deterministically by the graph validator afterward, so they don't need a
// GPT reasoning model; keeping all graph-related paths on one fast Gemini
// model also keeps graph upkeep cheap and behaviorally consistent.
export const GRAPH_MAINTENANCE_ROUTE_OWNERSHIP = {
  provider: 'gemini',
  model: GRAPH_GENERATION_ROUTE_OWNERSHIP.model,
  fallbackProviders: [],
  features: [
    'graph_interaction_analyzer',
    'graph_manager',
    'graph_recommendation',
  ],
} as const
