import assert from 'node:assert/strict'
import test from 'node:test'
import {
  COURSE_PLANNING_ROUTE_OWNERSHIP,
  GRAPH_GENERATION_ROUTE_OWNERSHIP,
  GRAPH_MAINTENANCE_ROUTE_OWNERSHIP,
} from './routeOwnership.ts'

test('course planning and lesson preparation are fixed to GPT-5.4', () => {
  assert.equal(COURSE_PLANNING_ROUTE_OWNERSHIP.provider, 'openai')
  assert.equal(COURSE_PLANNING_ROUTE_OWNERSHIP.model, 'gpt-5.4')
  assert.deepEqual(COURSE_PLANNING_ROUTE_OWNERSHIP.fallbackProviders, [])
  assert.deepEqual(COURSE_PLANNING_ROUTE_OWNERSHIP.features, [
    'curriculum_preview',
    'curriculum_generation',
    'topic_plan_analysis',
  ])
})

test('graph generation is fixed to a Gemini 3.1 flash model without fallbacks', () => {
  assert.equal(GRAPH_GENERATION_ROUTE_OWNERSHIP.provider, 'gemini')
  assert.equal(GRAPH_GENERATION_ROUTE_OWNERSHIP.model, 'gemini-3.1-flash-lite')
  assert.deepEqual(GRAPH_GENERATION_ROUTE_OWNERSHIP.fallbackProviders, [])
})

test('model-assisted graph maintenance remains OpenAI-only', () => {
  assert.equal(GRAPH_MAINTENANCE_ROUTE_OWNERSHIP.provider, 'openai')
  assert.deepEqual(GRAPH_MAINTENANCE_ROUTE_OWNERSHIP.fallbackProviders, [])
  assert.deepEqual(GRAPH_MAINTENANCE_ROUTE_OWNERSHIP.features, [
    'graph_interaction_analyzer',
    'graph_manager',
    'graph_recommendation',
  ])
})
