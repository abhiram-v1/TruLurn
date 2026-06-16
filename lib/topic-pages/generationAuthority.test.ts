import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildGenerationAuthority,
  enforceGenerationAuthority,
} from './generationAuthority.ts'

function plan(overrides: Record<string, unknown> = {}) {
  return {
    page_number: 1,
    focus: 'Explain the planned mechanism',
    content_kind: 'full_page',
    page_sequence_role: 'introduce',
    target_length: 'medium',
    target_words: 560,
    soft_max_words: 680,
    concepts: ['planned mechanism', 'resulting behavior'],
    start_boundary: 'Begin with the mechanism inputs.',
    end_boundary: 'Reach the resulting behavior.',
    continues_from_previous: false,
    continues_to_next: true,
    break_preference: 'natural_pause',
    break_reason: 'The causal chain reaches a stable reasoning pause.',
    brief: null,
    ...overrides,
  } as any
}

function brief(overrides: Record<string, unknown> = {}) {
  return {
    target_understanding: 'The learner can explain why the mechanism changes the result.',
    success_criteria: ['Explain the causal chain.'],
    why_this_matters_now: 'The next page applies the mechanism.',
    required_prior_knowledge: [],
    prior_knowledge_repair: [],
    likely_misconceptions: [],
    intuition_plan: 'Use a causal chain.',
    representation_plan: ['prose'],
    example_strategy: {
      opening_example: null,
      worked_example_needed: false,
      contrast_case_needed: false,
      reusable_example_refs: [],
    },
    active_processing: {
      retrieval_prompt: null,
      self_explanation_prompt: null,
      transfer_prompt: null,
    },
    page_sequence_role: 'introduce',
    cross_page_connection: 'Connects the definition to application.',
    cognitive_load_notes: [],
    retention_hooks: {
      revisit_concepts: [],
      retrieval_prompt: null,
      contrast_prompt: null,
      transfer_prompt: null,
    },
    recommended_content_kind: 'full_page',
    confidence: 'high',
    reason: 'A focused explanation is needed.',
    ...overrides,
  } as any
}

function generatedPage(overrides: Record<string, unknown> = {}) {
  return {
    page_number: 99,
    focus: 'Model-selected focus',
    content: 'A substantive explanation because the mechanism changes the result.',
    summary: 'Summary',
    key_concepts: ['mechanism'],
    topic_depth: 'medium',
    concept_kind: 'mechanism',
    content_kind: 'full_page',
    should_generate_page: false,
    decision_reason: 'The model tried to skip it.',
    estimated_length: 'long',
    requires_quiz: false,
    covered_concepts: ['mechanism'],
    reused_concepts: [],
    reminder_concepts: [],
    example_refs: [],
    sections: [{ type: 'core', content: 'Core explanation' }],
    page_mode: 'critical',
    core_realization: 'Model-selected realization',
    ...overrides,
  } as any
}

test('course boundary rejects uncovered source-grounded topics', () => {
  const contract = buildGenerationAuthority({
    course: { mode: 'source_grounded' },
    topic: { source_coverage: 'inferred' },
    pageNumber: 1,
    pageCount: 1,
    focus: 'Out-of-scope topic',
    plannedPage: plan(),
    architecture: brief(),
  })

  assert.equal(contract.scope.owner, 'course_boundary')
  assert.equal(contract.scope.allowed, false)
  assert.match(contract.scope.reason, /covered canonical topic/i)
})

test('topic plan owns shape even when the page brief disagrees', () => {
  const contract = buildGenerationAuthority({
    course: { mode: 'ai_teacher' },
    topic: {},
    pageNumber: 1,
    pageCount: 2,
    focus: 'Fallback focus',
    plannedPage: plan({ content_kind: 'bridge', target_length: 'long' }),
    architecture: brief({ recommended_content_kind: 'full_page' }),
  })

  assert.equal(contract.sequence.owner, 'topic_plan')
  assert.equal(contract.sequence.content_kind, 'bridge')
  assert.equal(contract.sequence.page_mode, 'micro')
  assert.equal(contract.sequence.target_length, 'long')
  assert.equal(contract.objective.owner, 'page_brief')
  assert.equal(contract.objective.target_understanding, brief().target_understanding)
})

test('topic plan locks physical boundaries and continuation behavior', () => {
  const planned = plan()
  const contract = buildGenerationAuthority({
    course: { mode: 'ai_teacher' },
    topic: {},
    pageNumber: 1,
    pageCount: 2,
    focus: 'Fallback focus',
    plannedPage: planned,
    architecture: brief(),
  })

  assert.equal(contract.sequence.target_words, 560)
  assert.equal(contract.sequence.soft_max_words, 680)
  assert.deepEqual(contract.sequence.concepts, planned.concepts)
  assert.equal(contract.sequence.start_boundary, planned.start_boundary)
  assert.equal(contract.sequence.end_boundary, planned.end_boundary)
  assert.equal(contract.sequence.continues_from_previous, false)
  assert.equal(contract.sequence.continues_to_next, true)
  assert.equal(contract.sequence.break_preference, 'natural_pause')
})

test('page modes are deterministic from planned shape', () => {
  const cases = [
    { kind: 'bridge', length: 'short', mode: 'micro', generate: true },
    { kind: 'section', length: 'short', mode: 'short', generate: true },
    { kind: 'example', length: 'medium', mode: 'short', generate: true },
    { kind: 'full_page', length: 'medium', mode: 'full', generate: true },
    { kind: 'full_page', length: 'long', mode: 'critical', generate: true },
    { kind: 'skip', length: 'short', mode: 'micro', generate: false },
  ] as const

  for (const sample of cases) {
    const contract = buildGenerationAuthority({
      course: { mode: 'ai_teacher' },
      topic: {},
      pageNumber: 1,
      pageCount: 1,
      focus: 'Focus',
      plannedPage: plan({
        content_kind: sample.kind,
        target_length: sample.length,
      }),
    })
    assert.equal(contract.sequence.page_mode, sample.mode)
    assert.equal(contract.sequence.should_generate_page, sample.generate)
  }
})

test('writer output cannot change sequence, shape, objective, or existence', () => {
  const architecture = brief()
  const contract = buildGenerationAuthority({
    course: { mode: 'ai_teacher' },
    topic: {},
    pageNumber: 1,
    pageCount: 2,
    focus: 'Fallback focus',
    plannedPage: plan(),
    architecture,
  })
  const enforced = enforceGenerationAuthority(generatedPage(), contract)

  assert.equal(enforced.page_number, 1)
  assert.equal(enforced.focus, plan().focus)
  assert.equal(enforced.content_kind, 'full_page')
  assert.equal(enforced.page_mode, 'full')
  assert.equal(enforced.estimated_length, 'medium')
  assert.equal(enforced.should_generate_page, true)
  assert.equal(enforced.core_realization, architecture.target_understanding)
  assert.deepEqual(enforced.generation_authority, contract)
})
