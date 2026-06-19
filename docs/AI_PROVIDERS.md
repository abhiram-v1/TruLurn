# AI Providers

TruLurn routes AI requests by feature, not by calling provider clients from
application code. Feature code calls `generateAI`, `generateAIResult`, or
`searchAI` from `lib/ai`.

## Configuration

`AI_PROVIDER` is the global default:

```env
AI_PROVIDER=openai
```

Override any feature independently:

```env
AI_FEATURE_TOPIC_PAGE_GENERATION_PROVIDER=gemini
AI_FEATURE_TOPIC_PAGE_GENERATION_MODEL=gemini-2.5-flash

AI_FEATURE_SOURCE_ORDERING_PROVIDER=gemini
AI_FEATURE_SOURCE_ORDERING_FALLBACK_PROVIDERS=openai

AI_FEATURE_EMBEDDINGS_PROVIDER=openai
AI_FEATURE_EMBEDDINGS_MODEL=text-embedding-3-small
AI_FEATURE_EMBEDDINGS_DIMENSIONS=768
```

Feature environment variables use this format:

```text
AI_FEATURE_<FEATURE_NAME>_PROVIDER
AI_FEATURE_<FEATURE_NAME>_MODEL
AI_FEATURE_<FEATURE_NAME>_FALLBACK_PROVIDERS
```

Fallback providers are comma-separated and are attempted only when explicitly
configured by the route or environment. Models are resolved per provider, so a
Gemini model name is never passed to an OpenAI fallback, or vice versa.

## Feature Names

The authoritative feature union is in `lib/ai/types.ts`, and defaults live in
`lib/ai/routing.ts`. Current features include:

```text
agent_action
agent_intent
agent_style
curriculum_generation
curriculum_research
doubt_answer
doubt_classification
embeddings
exam_evaluation
exam_question_generation
exam_strategy
flow_tracking
graph_recommendation
lesson_research
lesson_style_analysis
lesson_style_selection
graph_generation
page_analysis
prerequisite_gap_analysis
quiz_generation
recall_interruption
recall_page_generation
source_learning_page
source_ordering
source_profile
topic_page_generation
topic_plan_analysis
topic_transform
topic_validation
```

Web-search features currently default to OpenAI because the Gemini adapter does
not expose web search. The router rejects providers that do not implement a
feature's required capability.

## Adding A Provider

1. Add its name to `AI_PROVIDER_NAMES` in `lib/ai/types.ts`.
2. Implement an `AIProviderAdapter`.
3. Register it in `lib/ai/providers/registry.ts`.
4. Add provider-specific model defaults in `lib/ai/routing.ts` where needed.

Application features should never import files from `lib/ai/gemini` or
`lib/ai/openai`. Those modules are provider adapters only.
