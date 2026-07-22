import assert from 'node:assert/strict'
import test from 'node:test'
import { buildLessonFeedbackDirective, feedbackReasonToApproach } from './lessonFeedback.ts'

test('maps lesson feedback reasons to an immediate regeneration approach', () => {
  assert.equal(feedbackReasonToApproach('Needed an example'), 'show_example')
  assert.equal(feedbackReasonToApproach('Too much jargon'), 'simplify')
  assert.equal(feedbackReasonToApproach('Skipped edge cases'), 'go_deeper')
  assert.equal(feedbackReasonToApproach('Explanation was confusing'), 'explain_again')
})

test('turns stored feedback into a scoped writer directive', () => {
  const directive = buildLessonFeedbackDirective({
    feedback_last_signal: 'lost_me',
    feedback_last_reason: 'Needed an example',
    feedback_last_note: 'Use an example from APIs.',
  })

  assert.match(directive, /concrete worked example/i)
  assert.match(directive, /preference evidence only/i)
  assert.match(directive, /not curriculum scope/i)
})

test('returns no directive when there is no feedback', () => {
  assert.equal(buildLessonFeedbackDirective({}), '')
})
