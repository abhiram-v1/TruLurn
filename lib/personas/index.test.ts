import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPersonaVisualReasoningDirective } from './visualReasoning.ts'
import { buildTextbookContinuityDirective } from './textbookContinuity.ts'

test('the shared persona policy covers every surface without domain bias', () => {
  for (const surface of ['lesson', 'agent', 'quiz', 'recall'] as const) {
    const directive = buildPersonaVisualReasoningDirective(surface)
    assert.match(directive, /VISUAL REASONING/)
    assert.match(directive, /active course skill context/i)
    assert.doesNotMatch(directive, /machine learning|data science|DSA|DBMS/i)
  }
})

test('textbook continuity suppresses page-shaped openings and conclusions', () => {
  const directive = buildTextbookContinuityDirective({
    continuesFromPrevious: true,
    continuesToNext: true,
    targetWords: 720,
    softMaxWords: 840,
  })

  assert.match(directive, /direct continuation/i)
  assert.match(directive, /Do not conclude the topic/i)
  assert.match(directive, /720 words as an upper budget/i)
  assert.match(directive, /up to 840 words/i)
})
