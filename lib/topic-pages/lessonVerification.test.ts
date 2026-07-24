import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildLessonVerificationRepairDirective,
  enforceHardStampVerification,
  normalizeLessonVerificationReport,
} from './lessonVerification.ts'

function raw(overrides: Record<string, unknown> = {}) {
  return {
    accepted: true,
    scores: {
      factual_accuracy: 95,
      internal_consistency: 95,
      continuity: 92,
      dependency_clarity: 94,
      terminology_consistency: 96,
      instructional_coverage: 90,
    },
    issues: [],
    relationship_checks: [{
      source_concept: 'Gradient Descent',
      target_concept: 'Backpropagation',
      roles_distinct: true,
      relationship_explicit: true,
      technically_accurate: true,
      notes: 'Backpropagation computes gradients; gradient descent applies them to updates.',
    }],
    coverage: {
      definition: 'present',
      intuition: 'present',
      mechanism: 'present',
      formula: 'present',
      example: 'present',
      prior_connection: 'present',
      hard_stamp: 'not_required',
    },
    summary: 'Accurate and connected.',
    ...overrides,
  }
}

test('accepts a technically distinct and explicit prerequisite relationship', () => {
  const report = normalizeLessonVerificationReport(raw())
  assert.equal(report.accepted, true)
})

test('normalizes a provider response that consistently uses a zero-to-one score scale', () => {
  const report = normalizeLessonVerificationReport(raw({
    scores: {
      factual_accuracy: 0.95,
      internal_consistency: 0.94,
      continuity: 0.92,
      dependency_clarity: 1,
      terminology_consistency: 0.96,
      instructional_coverage: 0.9,
    },
  }))
  assert.equal(report.accepted, true)
  assert.equal(report.scores.dependency_clarity, 100)
  assert.equal(report.scores.instructional_coverage, 90)
})

test('rejects model acceptance when a required relationship conflates the concepts', () => {
  const report = normalizeLessonVerificationReport(raw({
    relationship_checks: [{
      source_concept: 'Gradient Descent',
      target_concept: 'Backpropagation',
      roles_distinct: false,
      relationship_explicit: true,
      technically_accurate: false,
      notes: 'The draft calls them the same process.',
    }],
  }))
  assert.equal(report.accepted, false)
})

test('rejects a critical factual issue even when the model sets accepted=true', () => {
  const report = normalizeLessonVerificationReport(raw({
    issues: [{
      code: 'incorrect_update_rule',
      severity: 'critical',
      message: 'The sign of the update is wrong.',
      repair_instruction: 'Subtract the learning-rate-scaled gradient.',
    }],
  }))
  assert.equal(report.accepted, false)
  assert.match(buildLessonVerificationRepairDirective(report), /Subtract the learning-rate-scaled gradient/)
})

test('rejects a required hard stamp when the semantic reviewer cannot find it', () => {
  const report = normalizeLessonVerificationReport(raw({
    coverage: {
      definition: 'present',
      intuition: 'present',
      mechanism: 'present',
      formula: 'present',
      example: 'present',
      prior_connection: 'present',
      hard_stamp: 'missing',
    },
  }))
  const enforced = enforceHardStampVerification(report, true)
  assert.equal(enforced.accepted, false)
  assert.ok(enforced.issues.some((issue) => issue.code === 'hard_stamp_not_verified'))
})
