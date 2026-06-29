import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AI_MODEL_TIERS,
  resolveAIFeatureRoute,
} from './routing.ts'
import type { AIFeature } from './types.ts'

const FAST_FEATURES: AIFeature[] = [
  'agent_action',
  'agent_intent',
  'agent_style',
  'doubt_classification',
  'flow_tracking',
  'learner_audience',
  'recall_interruption',
  'recall_page_generation',
  'source_ordering',
  'source_profile',
  'prompt_enhancement',
  'curriculum_ideas',
]

const CONTROL_FEATURES: AIFeature[] = [
  'exam_evaluation',
  'exam_strategy',
  'page_analysis',
  'prerequisite_gap_analysis',
  'source_grounding_verification',
  'topic_validation',
]

const PREMIUM_FEATURES: AIFeature[] = [
  'doubt_answer',
  'exam_question_generation',
  'quiz_generation',
  'topic_transform',
]

const PRESERVED_SPECIALIZED_FEATURES: AIFeature[] = [
  'curriculum_generation',
  'curriculum_research',
  'embeddings',
  'graph_generation',
  'lesson_research',
  'source_learning_page',
  'topic_page_generation',
]

function withoutRoutingEnvironment<T>(run: () => T) {
  const original = { ...process.env }
  try {
    for (const key of Object.keys(process.env)) {
      if (
        key === 'AI_PROVIDER'
        || key.startsWith('AI_FEATURE_')
        || key.startsWith('GEMINI_')
        || key.startsWith('OPENAI_')
      ) {
        delete process.env[key]
      }
    }
    return run()
  } finally {
    process.env = original
  }
}

test('supporting features resolve through explicit model tiers', () => {
  withoutRoutingEnvironment(() => {
    for (const feature of FAST_FEATURES) {
      const route = resolveAIFeatureRoute(feature)
      assert.equal(route.provider, AI_MODEL_TIERS.fast.provider, feature)
      assert.equal(route.model, AI_MODEL_TIERS.fast.models.gemini, feature)
      assert.deepEqual(route.fallbackProviders, [], feature)
    }
    for (const feature of CONTROL_FEATURES) {
      const route = resolveAIFeatureRoute(feature)
      assert.equal(route.provider, AI_MODEL_TIERS.control.provider, feature)
      assert.equal(route.model, AI_MODEL_TIERS.control.models.openai, feature)
      assert.deepEqual(route.fallbackProviders, [], feature)
    }
    for (const feature of PREMIUM_FEATURES) {
      const route = resolveAIFeatureRoute(feature)
      assert.equal(route.provider, AI_MODEL_TIERS.premium.provider, feature)
      assert.equal(route.model, AI_MODEL_TIERS.premium.models.openai, feature)
      assert.deepEqual(route.fallbackProviders, [], feature)
    }
  })
})

test('course planning routes resolve to GPT-5.4 and ignore provider overrides', () => {
  withoutRoutingEnvironment(() => {
    process.env.AI_FEATURE_CURRICULUM_PREVIEW_PROVIDER = 'gemini'
    process.env.AI_FEATURE_CURRICULUM_GENERATION_PROVIDER = 'gemini'
    process.env.AI_FEATURE_TOPIC_PLAN_ANALYSIS_PROVIDER = 'gemini'

    for (const feature of [
      'curriculum_preview',
      'curriculum_generation',
      'topic_plan_analysis',
    ] as const) {
      const route = resolveAIFeatureRoute(feature)
      assert.equal(route.provider, 'openai', feature)
      assert.equal(route.model, 'gpt-5.4', feature)
      assert.deepEqual(route.fallbackProviders, [], feature)
    }
  })
})

test('specialized lesson, curriculum, research, embedding, and graph routes are preserved', () => {
  withoutRoutingEnvironment(() => {
    process.env.AI_PROVIDER = 'openai'
    for (const feature of PRESERVED_SPECIALIZED_FEATURES) {
      const route = resolveAIFeatureRoute(feature)
      if (feature === 'graph_generation') {
        assert.equal(route.provider, 'gemini')
        assert.equal(route.model, 'gemini-3.1-flash-lite')
      } else if (feature === 'curriculum_research' || feature === 'lesson_research') {
        assert.equal(route.provider, 'openai')
        assert.equal(route.model, 'gpt-5.4-mini')
        assert.deepEqual(route.fallbackProviders, [])
      } else if (feature === 'curriculum_generation') {
        assert.equal(route.provider, 'openai', feature)
        assert.equal(route.model, 'gpt-5.4', feature)
        assert.deepEqual(route.fallbackProviders, [], feature)
      } else {
        assert.equal(route.provider, 'openai', feature)
      }
    }
  })
})

test('feature overrides remain available and fallback requires explicit configuration', () => {
  withoutRoutingEnvironment(() => {
    process.env.AI_FEATURE_TOPIC_VALIDATION_PROVIDER = 'gemini'
    process.env.AI_FEATURE_TOPIC_VALIDATION_MODEL = 'gemini-3.5-flash'
    process.env.AI_FEATURE_TOPIC_VALIDATION_FALLBACK_PROVIDERS = 'openai'

    const route = resolveAIFeatureRoute('topic_validation')
    assert.equal(route.provider, 'gemini')
    assert.equal(route.model, 'gemini-3.5-flash')
    assert.deepEqual(route.fallbackProviders, ['openai'])
  })
})
