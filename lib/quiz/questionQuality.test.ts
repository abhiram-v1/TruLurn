import assert from 'node:assert/strict'
import test from 'node:test'
import { validateQuizQuestion, type QuizQuestionDraft } from './questionQuality.ts'

const VALID_MCQ: QuizQuestionDraft = {
  type: 'mcq',
  question: 'A cache entry expires while two requests arrive together. Which outcome best demonstrates request coalescing?',
  options: ['A. Both requests recompute', 'B. One recomputes while the other waits', 'C. Both return stale data forever', 'D. The cache deletes the database'],
  correct_answer: 'B. One recomputes while the other waits',
  answer_explanation: 'Request coalescing lets one request refresh the entry while concurrent requests share or await that work.',
  rubric: 'The answer must connect one in-flight refresh with prevention of duplicate downstream work.',
}

test('accepts a complete reasoning-first MCQ', () => {
  assert.deepEqual(validateQuizQuestion(VALID_MCQ), [])
})

test('rejects duplicate options and a correct answer outside the option set', () => {
  const issues = validateQuizQuestion({
    ...VALID_MCQ,
    options: ['A. Same', 'B. Same', 'C. Third', 'D. Fourth'],
    correct_answer: 'E. Missing',
  })
  assert.ok(issues.some((issue) => issue.code === 'duplicate_options'))
  assert.ok(issues.some((issue) => issue.code === 'missing_correct_option'))
})

test('rejects definition lookups and banned option shortcuts', () => {
  const issues = validateQuizQuestion({
    ...VALID_MCQ,
    question: 'Which term is used for this cache behavior in the lesson material?',
    options: ['A. Coalescing', 'B. Expiration', 'C. Eviction', 'D. None of the above'],
    correct_answer: 'A. Coalescing',
  })
  assert.ok(issues.some((issue) => issue.code === 'definition_lookup'))
  assert.ok(issues.some((issue) => issue.code === 'banned_option'))
})

test('requires a deterministic true/false answer and explanation', () => {
  const issues = validateQuizQuestion({
    type: 'true_false',
    question: 'Increasing the cache TTL always improves correctness for rapidly changing records.',
    options: null,
    correct_answer: null,
    answer_explanation: null,
    rubric: 'The learner should connect a longer TTL with increased staleness risk.',
  })
  assert.ok(issues.some((issue) => issue.code === 'invalid_true_false_answer'))
  assert.ok(issues.some((issue) => issue.code === 'missing_answer_explanation'))
})

test('detects a substantially repeated question', () => {
  const issues = validateQuizQuestion(VALID_MCQ, [
    'Two requests arrive together just as a cache entry expires. Which result best demonstrates request coalescing?',
  ])
  assert.ok(issues.some((issue) => issue.code === 'duplicate_question'))
})
