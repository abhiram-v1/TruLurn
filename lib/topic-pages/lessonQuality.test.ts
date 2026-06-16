import assert from 'node:assert/strict'
import test from 'node:test'

import { evaluateLessonQuality } from './lessonQuality.ts'

function pagePlan(overrides: Record<string, unknown> = {}) {
  return {
    page_number: 1,
    focus: 'Build a causal mental model',
    content_kind: 'full_page',
    page_sequence_role: 'deepen',
    target_length: 'medium',
    target_words: 220,
    soft_max_words: 280,
    concepts: ['causal model', 'state change'],
    start_boundary: 'Continue from the input conditions.',
    end_boundary: 'Reach the prediction step.',
    continues_from_previous: true,
    continues_to_next: true,
    break_preference: 'natural_pause',
    break_reason: 'The prediction is a stable reasoning pause.',
    brief: null,
    ...overrides,
  } as any
}

function basePage(overrides: Record<string, unknown> = {}) {
  const content = [
    '## Causal Mental Models',
    'A useful model is a compressed explanation that preserves the relationships needed for a decision.',
    'It matters because a learner should be able to predict what changes when one part of the system moves.',
    'The mechanism has three parts: an input creates a state change, that state constrains the available actions, and the resulting action produces evidence that can update the model.',
    'This means understanding is more than remembering a definition. The learner must connect cause to effect, distinguish the boundary cases, and explain why the same rule does not apply everywhere.',
    'A concrete case makes the structure visible. When the input changes but the state does not, the expected action should remain stable; when the state changes, the action should change for a specific reason.',
    'The key is to use the model to make a prediction and then check that prediction against the observed result.',
  ].join('\n\n')

  return {
    page_number: 1,
    focus: 'Build a causal mental model',
    content,
    summary: 'A causal mental model connects inputs, state changes, actions, and evidence.',
    key_concepts: ['causal model', 'state change', 'prediction'],
    topic_depth: 'medium',
    concept_kind: 'concept',
    content_kind: 'section',
    should_generate_page: true,
    decision_reason: 'This concept is needed for later application.',
    estimated_length: 'medium',
    requires_quiz: false,
    covered_concepts: ['causal model'],
    reused_concepts: [],
    reminder_concepts: [],
    example_refs: [],
    sections: [
      { type: 'core', title: 'Core model', content },
      {
        type: 'examples',
        title: 'Concrete case',
        content: 'Changing the state changes the action because the available choices are different.',
      },
    ],
    page_mode: 'micro',
    topic_type: 'conceptual',
    core_realization: 'A causal mental model explains how inputs change state and why that changes the resulting action.',
    example_to_use: 'Use a state change to predict which action becomes available.',
    ...overrides,
  } as any
}

function architecture(overrides: Record<string, unknown> = {}) {
  return {
    target_understanding: 'A causal mental model explains how inputs change state and action.',
    success_criteria: ['Predict the effect of a state change.'],
    why_this_matters_now: 'Later pages require causal predictions.',
    required_prior_knowledge: [],
    prior_knowledge_repair: [],
    likely_misconceptions: [],
    intuition_plan: 'Connect input, state, action, and evidence.',
    representation_plan: ['causal chain'],
    example_strategy: {
      opening_example: null,
      worked_example_needed: true,
      contrast_case_needed: false,
      reusable_example_refs: [],
    },
    active_processing: {
      retrieval_prompt: 'What changes after the input changes?',
      self_explanation_prompt: null,
      transfer_prompt: null,
    },
    page_sequence_role: 'introduce',
    cross_page_connection: 'Prepares the learner for application.',
    cognitive_load_notes: [],
    retention_hooks: {
      revisit_concepts: ['state change'],
      retrieval_prompt: 'Reconstruct the causal chain.',
      contrast_prompt: null,
      transfer_prompt: null,
    },
    recommended_content_kind: 'section',
    confidence: 'high',
    reason: 'The page establishes a reusable model.',
    ...overrides,
  } as any
}

test('accepts representative lessons across subjects and levels', () => {
  const cases = [
    { title: 'Machine learning', level: 'beginner' },
    { title: 'Differential calculus', level: 'intermediate' },
    { title: 'Database isolation', level: 'expert' },
  ]

  for (const sample of cases) {
    const report = evaluateLessonQuality({
      page: basePage(),
      topic: sample,
      pageNumber: 1,
      architecture: architecture(),
    })
    assert.equal(report.accepted, true, `${sample.title} (${sample.level}) should pass`)
    assert.ok(report.overall_score >= report.threshold)
  }
})

test('still flags a canned opening but does not dead-end a high-scoring page', () => {
  // Policy: a canned hook is a stylistic critical, not a hard block. It is still
  // reported (so the repair directive and logs see it), but a page that clears
  // the score bar is served rather than dead-ended.
  const page = basePage({
    content: `Suppose you want to build a spam filter.\n\n${basePage().content}`,
  })
  const report = evaluateLessonQuality({
    page,
    topic: { title: 'Machine learning' },
    pageNumber: 1,
    architecture: architecture(),
  })

  assert.ok(report.issues.some((issue) => issue.code === 'OPENING_CANNED_HOOK'))
  assert.ok(report.overall_score >= report.threshold)
  assert.equal(report.accepted, true)
})

test('still flags a missing required example but does not dead-end a high-scoring page', () => {
  const page = basePage({
    content: basePage().content.replace('A concrete case makes the structure visible.', 'The structure can now be summarized.'),
    sections: [{ type: 'core', title: 'Core model', content: basePage().content }],
    example_to_use: undefined,
  })
  const report = evaluateLessonQuality({
    page,
    topic: { title: 'Systems thinking' },
    pageNumber: 1,
    architecture: architecture(),
  })

  assert.ok(report.issues.some((issue) => issue.code === 'required_example_missing'))
  assert.ok(report.overall_score >= report.threshold)
  assert.equal(report.accepted, true)
})

test('hard-blocks a structurally incomplete page regardless of any score', () => {
  // Hard blocks (no core, placeholder, unverified source) still reject outright.
  const page = basePage({
    content: 'Machine learning is useful.',
    sections: [{ type: 'core', title: 'Core', content: 'Machine learning is useful.' }],
  })
  const report = evaluateLessonQuality({
    page,
    topic: { title: 'Machine learning' },
    pageNumber: 1,
    architecture: architecture(),
  })

  assert.equal(report.accepted, false)
  assert.ok(report.issues.some((issue) => issue.code === 'missing_substantive_core'))
})

test('rejects shallow content and internal repetition', () => {
  const repeated = 'A model connects inputs to outputs because relationships determine the result.'
  const page = basePage({
    content: `${repeated}\n\n${repeated}`,
    sections: [{ type: 'core', title: 'Core model', content: repeated }],
  })
  const report = evaluateLessonQuality({
    page,
    topic: { title: 'Models' },
    pageNumber: 1,
  })

  assert.equal(report.accepted, false)
  assert.ok(report.issues.some((issue) =>
    issue.code === 'too_shallow' || issue.code === 'internal_repetition'))
})

test('rejects source-grounded content without supported citations', () => {
  const report = evaluateLessonQuality({
    page: basePage(),
    topic: { title: 'Source topic' },
    pageNumber: 1,
    architecture: architecture(),
    sourceGrounded: true,
  })

  assert.equal(report.accepted, false)
  assert.ok(report.issues.some((issue) => issue.code === 'source_verification_missing'))
})

test('accepts source-grounded content after verification', () => {
  const page = basePage({
    source_citations: [{ source_id: 'source-1', chunk_id: 'chunk-1' }],
    grounding: {
      status: 'supported',
      checked_claims: 4,
      supported_claims: 4,
      unsupported_claims: [],
    },
  })
  const report = evaluateLessonQuality({
    page,
    topic: { title: 'Source topic' },
    pageNumber: 1,
    architecture: architecture(),
    sourceGrounded: true,
  })

  assert.equal(report.accepted, true)
  assert.equal(report.dimensions.source_faithfulness, 100)
})

test('accepts direct textbook continuation without announcing the previous page', () => {
  const report = evaluateLessonQuality({
    page: basePage({ page_number: 2 }),
    topic: { title: 'Systems thinking' },
    pageNumber: 2,
    previousPages: [{
      content: 'Earlier material established the vocabulary and identified the system boundary.',
    }],
    architecture: architecture({ page_sequence_role: 'deepen' }),
    pagePlan: pagePlan(),
  })

  assert.equal(report.accepted, true)
  assert.ok(!report.issues.some((issue) => issue.code === 'continuity_missing'))
})

test('rejects an artificial conclusion when the manuscript continues', () => {
  const page = basePage({
    content: `${basePage().content}\n\nIn summary, the key takeaway is that the model supports prediction.`,
  })
  const report = evaluateLessonQuality({
    page,
    topic: { title: 'Systems thinking' },
    pageNumber: 1,
    architecture: architecture(),
    pagePlan: pagePlan({ continues_from_previous: false }),
  })

  assert.equal(report.accepted, false)
  assert.ok(report.issues.some((issue) => issue.code === 'premature_page_closure'))
})

test('allows a nearly complete thought to use the soft overflow allowance', () => {
  const report = evaluateLessonQuality({
    page: basePage(),
    topic: { title: 'Systems thinking' },
    pageNumber: 1,
    architecture: architecture(),
    pagePlan: pagePlan({
      target_words: 100,
      soft_max_words: 220,
      continues_from_previous: false,
      continues_to_next: false,
    }),
  })

  assert.equal(report.accepted, true)
  assert.ok(!report.issues.some((issue) => issue.code === 'soft_page_limit_exceeded'))
})

test('rejects content beyond the planned soft maximum', () => {
  const report = evaluateLessonQuality({
    page: basePage(),
    topic: { title: 'Systems thinking' },
    pageNumber: 1,
    architecture: architecture(),
    pagePlan: pagePlan({
      target_words: 80,
      soft_max_words: 100,
      continues_from_previous: false,
      continues_to_next: false,
    }),
  })

  assert.equal(report.accepted, false)
  assert.ok(report.issues.some((issue) => issue.code === 'soft_page_limit_exceeded'))
})

test('rejects an avoidably underfilled page while material continues', () => {
  const report = evaluateLessonQuality({
    page: basePage(),
    topic: { title: 'Systems thinking' },
    pageNumber: 1,
    architecture: architecture(),
    pagePlan: pagePlan({
      target_words: 500,
      soft_max_words: 620,
      continues_from_previous: false,
      continues_to_next: true,
    }),
  })

  assert.equal(report.accepted, false)
  assert.ok(report.issues.some((issue) => issue.code === 'planned_page_underfilled'))
})

test('rejects a planned concept span without a recognizable heading', () => {
  const page = basePage({
    content: basePage().content.replace('## Causal Mental Models\n\n', ''),
  })
  const report = evaluateLessonQuality({
    page,
    topic: { title: 'Systems thinking' },
    pageNumber: 1,
    architecture: architecture(),
    pagePlan: pagePlan({ continues_from_previous: false, continues_to_next: false }),
  })

  assert.equal(report.accepted, false)
  assert.ok(report.issues.some((issue) => issue.code === 'concept_heading_missing'))
})

test('rejects sentence-like and generic major headings', () => {
  for (const heading of ['## How Causal Models Work?', '## Overview']) {
    const page = basePage({
      content: basePage().content.replace('## Causal Mental Models', heading),
    })
    const report = evaluateLessonQuality({
      page,
      topic: { title: 'Systems thinking' },
      pageNumber: 1,
      architecture: architecture(),
      pagePlan: pagePlan({ continues_from_previous: false, continues_to_next: false }),
    })

    assert.equal(report.accepted, false)
    assert.ok(report.issues.some((issue) => issue.code === 'concept_heading_unclear'))
  }
})
