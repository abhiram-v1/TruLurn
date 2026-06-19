import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GRAPH_GENERATION_ROUTE_OWNERSHIP,
  GRAPH_MAINTENANCE_ROUTE_OWNERSHIP,
} from './routeOwnership.ts'

test('graph generation is fixed to Gemini 3.1 Pro without fallbacks', () => {
  assert.equal(GRAPH_GENERATION_ROUTE_OWNERSHIP.provider, 'gemini')
  assert.equal(GRAPH_GENERATION_ROUTE_OWNERSHIP.model, 'gemini-3.1-pro-preview')
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
