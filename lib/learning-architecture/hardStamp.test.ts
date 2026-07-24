import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeBrief, validateLearningArchitectureBrief } from './analyzePage.ts'

function rawBrief(overrides: Record<string, unknown> = {}) {
  return {
    target_understanding: 'Connect a known model to a new concept.',
    concept_importance: 'critical',
    concept_difficulty: 'medium',
    reasoning_need: 'high',
    teaching_depth: 4,
    requires_formal_definition: true,
    misconception_risk: 'high',
    success_criteria: ['Explain the mapping and its boundary.'],
    why_this_matters_now: 'The learner already knows the prerequisite model.',
    required_prior_knowledge: ['Logistic Regression'],
    prior_knowledge_repair: [],
    likely_misconceptions: ['A whole neural network is just logistic regression.'],
    intuition_plan: 'Reuse the known computation while renaming its parts precisely.',
    hard_stamp: null,
    representation_plan: ['prose', 'math'],
    example_strategy: {
      opening_example: null,
      worked_example_needed: true,
      contrast_case_needed: true,
      reusable_example_refs: [],
    },
    active_processing: {
      retrieval_prompt: 'What two operations does logistic regression perform?',
      self_explanation_prompt: null,
      transfer_prompt: null,
    },
    page_sequence_role: 'connect',
    cross_page_connection: 'Maps logistic regression onto one sigmoid neuron.',
    cognitive_load_notes: [],
    retention_hooks: { revisit_concepts: [], retrieval_prompt: null, contrast_prompt: null, transfer_prompt: null },
    recommended_content_kind: 'full_page',
    confidence: 'high',
    reason: 'A direct mapping removes avoidable terminology friction.',
    ...overrides,
  }
}

test('normalizes a required hard stamp into an auditable teaching contract', () => {
  const brief = normalizeBrief(rawBrief({
    hard_stamp: {
      required: true,
      kind: 'concept_connection',
      prior_concept: 'Logistic Regression',
      current_concept: 'Single Neuron',
      statement: 'A sigmoid neuron performs the logistic-regression computation.',
      mapping_steps: ['linear score -> pre-activation', 'sigmoid -> activation function'],
      boundary: 'This is a one-neuron correspondence, not the whole network.',
    },
  }))

  assert.equal(brief.hard_stamp?.kind, 'concept_connection')
  assert.equal(brief.hard_stamp?.prior_concept, 'Logistic Regression')
  assert.deepEqual(brief.hard_stamp?.mapping_steps, [
    'linear score -> pre-activation',
    'sigmoid -> activation function',
  ])
  assert.deepEqual(validateLearningArchitectureBrief(brief), [])
})

test('does not manufacture a hard stamp when the planner says it is unnecessary', () => {
  const brief = normalizeBrief(rawBrief({ hard_stamp: null }))
  assert.equal(brief.hard_stamp, null)
})

test('rejects an empty required hard stamp so the planner must repair it', () => {
  const brief = normalizeBrief(rawBrief({
    hard_stamp: {
      required: true,
      kind: 'mental_model',
      prior_concept: 'Logistic Regression',
      current_concept: '',
      statement: '',
      mapping_steps: [],
      boundary: null,
    },
  }))
  const errors = validateLearningArchitectureBrief(brief)
  assert.ok(errors.some((error) => /current_concept/.test(error)))
  assert.ok(errors.some((error) => /explicit statement/.test(error)))
  assert.ok(errors.some((error) => /mapping steps/.test(error)))
})
