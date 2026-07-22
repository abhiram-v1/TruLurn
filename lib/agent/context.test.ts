import assert from 'node:assert/strict'
import test from 'node:test'
import { formatSequenceProgress, planAgentContext } from './context.ts'

test('progress wording requests atlas context for completion questions', () => {
  const plan = planAgentContext('what have I completed up to now?')

  assert.equal(plan.needsAtlas, true)
  assert.match(plan.reason, /Atlas/)
})

test('sequence progress distinguishes generated position from learner-evidenced completion', () => {
  const text = formatSequenceProgress({
    currentTopicId: 'topic-4',
    topics: [
      { _id: 'topic-1', title: 'Foundations', state: 'mastered', sequence_index: 1 },
      { _id: 'topic-2', title: 'First Application', state: 'functional', sequence_index: 2 },
      { _id: 'topic-3', title: 'Loose Ends', state: 'partial', sequence_index: 3 },
      { _id: 'topic-4', title: 'Current Work', state: 'active', sequence_index: 4 },
      { _id: 'topic-5', title: 'Future Work', state: 'locked', sequence_index: 5 },
    ],
  })

  assert.match(text, /Current teachable node: Current Work \(4 of 5, active\)/)
  assert.match(text, /Learner-evidenced progress before current: 2 of 3/)
  assert.match(text, /Earlier nodes not yet settled: Loose Ends \(developing\)/)
  assert.match(text, /generated pages are not proof of mastery/)
})
