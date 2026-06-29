import assert from 'node:assert/strict'
import test from 'node:test'
import { detectFalseConfidence } from './falseConfidence.ts'

test('detects an explicit false_confidence flag rolled up from a turn evaluation', () => {
  assert.equal(detectFalseConfidence({ passed: false, false_confidence: true }), true)
  assert.equal(detectFalseConfidence({ passed: true, false_confidence: true }), true)
})

test('detects passed-but-flagged sessions (passed with review concepts)', () => {
  assert.equal(detectFalseConfidence({ passed: true, review_concepts: ['gradient descent'] }), true)
})

test('does not flag a clean pass with no review concepts', () => {
  assert.equal(detectFalseConfidence({ passed: true, review_concepts: [] }), false)
  assert.equal(detectFalseConfidence({ passed: true }), false)
})

test('does not flag a failed session merely for having review concepts', () => {
  // Failing is its own signal — false confidence specifically means "looked
  // fine but wasn't," not "did poorly."
  assert.equal(detectFalseConfidence({ passed: false, review_concepts: ['x'] }), false)
})

test('handles missing or malformed summaries safely', () => {
  assert.equal(detectFalseConfidence(null), false)
  assert.equal(detectFalseConfidence(undefined), false)
  assert.equal(detectFalseConfidence({} as any), false)
})
