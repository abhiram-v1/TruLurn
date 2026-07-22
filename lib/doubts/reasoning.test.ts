import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveDoubtReasoningEffort } from './reasoning.ts'

test('ordinary page clarifications use the low-latency reasoning path', () => {
  assert.equal(resolveDoubtReasoningEffort('current_page', 'What does this term mean?'), 'low')
  assert.equal(resolveDoubtReasoningEffort('general_knowledge', 'What is a vector?'), 'low')
})

test('formal and multi-step questions retain full reasoning quality', () => {
  assert.equal(
    resolveDoubtReasoningEffort('current_page', 'Derive this formula step by step.'),
    'medium',
  )
  assert.equal(
    resolveDoubtReasoningEffort('general_knowledge', 'Explain why this algorithm fails on that edge case.'),
    'medium',
  )
})

test('cross-course synthesis always retains medium reasoning', () => {
  assert.equal(resolveDoubtReasoningEffort('course_specific', 'Remind me what came before.'), 'medium')
})

