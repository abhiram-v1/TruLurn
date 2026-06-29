import assert from 'node:assert/strict'
import test from 'node:test'
import { scoreLessonReasoningEffort, selectLessonReasoningEffort } from './generateTopicPage.ts'
import type { GenerationAuthorityContract } from './generationAuthority.ts'
import type { LearningArchitectureBrief } from '../learning-architecture/analyzePage.ts'

function authority(
  overrides: Partial<GenerationAuthorityContract['sequence']> = {},
  objective = 'Understand gradient descent as iterative loss minimization.',
): GenerationAuthorityContract {
  return {
    version: 'generation-authority-v1',
    scope: {
      owner: 'course_boundary',
      allowed: true,
      mode: 'ai_teacher',
      reason: 'inside scope',
    },
    sequence: {
      owner: 'topic_plan',
      page_number: 1,
      page_count: 1,
      focus: 'Gradient descent',
      content_kind: 'full_page',
      page_mode: 'full',
      target_length: 'medium',
      page_sequence_role: 'introduce',
      should_generate_page: true,
      target_words: 560,
      soft_max_words: 680,
      concepts: ['gradient descent'],
      start_boundary: 'start',
      end_boundary: 'end',
      continues_from_previous: false,
      continues_to_next: false,
      break_preference: 'natural_pause',
      break_reason: 'complete idea',
      ...overrides,
    },
    objective: {
      owner: 'page_brief',
      target_understanding: objective,
      success_criteria: [],
    },
    writer: {
      owner: 'lesson_writer',
      controls: ['wording', 'examples', 'representation', 'section_usage', 'tone'],
    },
    acceptance: {
      owner: 'lesson_quality_evaluator',
      threshold: 75,
    },
  }
}

function brief(overrides: Partial<LearningArchitectureBrief> = {}): LearningArchitectureBrief {
  return {
    concept_importance: 'important',
    concept_difficulty: 'medium',
    reasoning_need: 'medium',
    teaching_depth: 3,
    requires_formal_definition: true,
    misconception_risk: 'medium',
    target_understanding: 'Understand the concept.',
    success_criteria: ['define', 'explain'],
    why_this_matters_now: 'needed now',
    required_prior_knowledge: [],
    prior_knowledge_repair: [],
    likely_misconceptions: [],
    intuition_plan: 'build intuition',
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
    cross_page_connection: 'connects to nearby pages',
    cognitive_load_notes: [],
    retention_hooks: {
      revisit_concepts: [],
      retrieval_prompt: null,
      contrast_prompt: null,
      transfer_prompt: null,
    },
    recommended_content_kind: 'full_page',
    confidence: 'medium',
    reason: 'test brief',
    ...overrides,
  }
}

test('simple non-full lesson spans use low reasoning effort', () => {
  const effort = selectLessonReasoningEffort({
    course: {},
    authority: authority({ content_kind: 'bridge', page_mode: 'micro', target_length: 'short' }),
  })

  assert.equal(effort, 'low')
})

test('normal full lesson spans use medium reasoning effort', () => {
  const effort = selectLessonReasoningEffort({
    course: {},
    authority: authority(),
    learningArchitecture: brief({ reasoning_need: 'medium' }),
  })

  assert.equal(effort, 'medium')
})

test('source-grounded critical pages with formal work use high reasoning effort', () => {
  const effort = selectLessonReasoningEffort({
    course: { mode: 'source_grounded', course_depth: 'high' },
    authority: authority({ page_mode: 'critical', target_length: 'long' }),
    sourceEvidence: [{ content: 'source A' } as any, { content: 'source B' } as any],
    learningArchitecture: brief({
      concept_importance: 'critical',
      concept_difficulty: 'high',
      reasoning_need: 'high',
      teaching_depth: 5,
      misconception_risk: 'high',
      target_understanding: 'Understand the derivation.',
      success_criteria: ['define', 'derive', 'apply'],
      likely_misconceptions: ['gradient direction'],
      representation_plan: ['formula', 'worked derivation'],
      example_strategy: {
        opening_example: 'loss curve',
        worked_example_needed: true,
        contrast_case_needed: false,
        reusable_example_refs: [],
      },
      active_processing: {
        retrieval_prompt: null,
        self_explanation_prompt: 'explain update rule',
        transfer_prompt: null,
      },
      page_sequence_role: 'deepen',
      confidence: 'high',
      reason: 'complex formal page',
    }),
  })

  assert.equal(effort, 'high')
})

test('planner-recommended high reasoning sets initial effort for critical neural-network optimization topics', () => {
  const cases = [
    'Gradient descent',
    'Stochastic gradient descent',
    'Batch gradient descent',
    'Mini-batch gradient descent',
  ]

  for (const focus of cases) {
    const result = scoreLessonReasoningEffort({
      course: { title: 'Neural Networks' },
      topic: { title: focus },
      authority: authority({ focus, concepts: [focus], start_boundary: focus, end_boundary: focus }, `Understand ${focus} in neural network training.`),
      learningArchitecture: brief({
        concept_importance: 'critical',
        concept_difficulty: 'high',
        reasoning_need: 'high',
        teaching_depth: 5,
        requires_formal_definition: true,
        misconception_risk: 'high',
        target_understanding: `Understand ${focus} in neural network training.`,
        representation_plan: ['formula', 'algorithm'],
        example_strategy: {
          opening_example: 'loss curve',
          worked_example_needed: true,
          contrast_case_needed: true,
          reusable_example_refs: [],
        },
        likely_misconceptions: ['confusing gradient direction with update direction'],
      }),
    })

    assert.equal(result.effort, 'high', focus)
    assert.equal(result.score, 5, focus)
    assert.ok(result.reasons.includes('planner recommended reasoning_need=high'), focus)
  }
})

test('planner-recommended medium reasoning keeps support topics at medium', () => {
  const cases = [
    'Epoch vs iteration',
    'Input normalization',
    'Activation function overview',
  ]

  for (const focus of cases) {
    const result = scoreLessonReasoningEffort({
      course: { title: 'Neural Networks' },
      topic: { title: focus },
      authority: authority({ focus, concepts: [focus], start_boundary: focus, end_boundary: focus }, `Understand ${focus}.`),
      learningArchitecture: brief({
        concept_importance: 'supporting',
        concept_difficulty: 'medium',
        reasoning_need: 'medium',
        teaching_depth: 3,
        target_understanding: `Understand ${focus}.`,
      }),
    })

    assert.equal(result.effort, 'medium', focus)
    assert.equal(result.score, 3, focus)
  }
})

test('planner-recommended low reasoning keeps peripheral topics low', () => {
  const cases = [
    'History of neural networks',
    'Notation: theta and weights',
  ]

  for (const focus of cases) {
    const result = scoreLessonReasoningEffort({
      course: { title: 'Neural Networks' },
      topic: { title: focus },
      authority: authority({
        focus,
        concepts: [focus],
        start_boundary: focus,
        end_boundary: focus,
        target_length: 'short',
      }, `Recognize ${focus}.`),
      learningArchitecture: brief({
        concept_importance: 'peripheral',
        concept_difficulty: 'low',
        reasoning_need: 'low',
        teaching_depth: 1,
        requires_formal_definition: false,
        misconception_risk: 'low',
        target_understanding: `Recognize ${focus}.`,
      }),
    })

    assert.equal(result.effort, 'low', focus)
    assert.equal(result.score, 1, focus)
  }
})

test('topic names alone no longer promote reasoning without AI metadata', () => {
  const result = scoreLessonReasoningEffort({
    course: { title: 'Neural Networks' },
    topic: { title: 'Gradient descent' },
    authority: authority(),
  })

  assert.equal(result.effort, 'medium')
  assert.equal(result.reasons.includes('core ML/NN optimization concept'), false)
})
