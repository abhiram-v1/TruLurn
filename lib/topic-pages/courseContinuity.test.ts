import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildCourseContinuityContext,
  buildCourseRetrievalScope,
  formatCourseContinuityContext,
} from './courseContinuity.ts'

const topics = [
  { _id: 'loss', title: 'Loss Functions', sequence_index: 1, key_concepts: ['loss'] },
  { _id: 'gd', title: 'Gradient Descent', sequence_index: 2, prerequisites: ['loss'], key_concepts: ['gradient', 'learning rate'] },
  {
    _id: 'bp',
    title: 'Backpropagation',
    sequence_index: 3,
    prerequisites: ['gd'],
    key_concepts: ['chain rule', 'parameter gradients'],
  },
  { _id: 'optimizers', title: 'Adaptive Optimizers', sequence_index: 4, prerequisites: ['bp'] },
]

test('retrieval scope includes only earlier topics and prioritizes dependency ancestry', () => {
  const scope = buildCourseRetrievalScope({ topics, currentTopicId: 'bp' })

  assert.deepEqual(scope.priorTopicIds, ['loss', 'gd'])
  assert.deepEqual(scope.directPrerequisiteIds, ['gd'])
  assert.deepEqual(scope.transitivePrerequisiteIds, ['loss'])
  assert.deepEqual(scope.requiredTopicIds, ['gd', 'loss'])
  assert.equal(scope.previousTopicId, 'gd')
  assert.ok(!scope.priorTopicIds.includes('optimizers'))
})

test('continuity context requires a taught prerequisite bridge and preserves exact terminology', () => {
  const context = buildCourseContinuityContext({
    topics,
    currentTopicId: 'bp',
    taughtTopicIds: ['loss', 'gd'],
    summariesByTopic: new Map([
      ['gd', {
        summary: 'Gradient descent uses a gradient to update parameters and reduce loss.',
        key_concepts: ['learning rate', 'parameter update'],
        hard_stamped_insights: [{
          kind: 'operational_rule',
          prior_concept: 'Loss Gradient',
          current_concept: 'Gradient Descent',
          statement: 'Gradient descent consumes a gradient; it does not compute the gradient.',
          mapping: 'loss gradient -> parameter update direction',
          boundary: 'The optimizer still needs another process to supply the gradient.',
        }],
      }],
    ]),
  })

  assert.equal(context.connections.length, 1)
  assert.equal(context.connections[0].required_in_explanation, true)
  assert.equal(context.connections[0].teaching_status, 'taught')
  assert.ok(context.canonical_terms.includes('Gradient Descent'))
  assert.ok(context.canonical_terms.includes('Backpropagation'))

  const directive = formatCourseContinuityContext(context)
  assert.match(directive, /Gradient Descent -> Backpropagation/)
  assert.match(directive, /Never imply they are the same process/)
  assert.match(directive, /Durable mental model already established/)
  assert.match(directive, /does not compute the gradient/)
  assert.match(directive, /callbacks must appear in the lesson prose/)
})

test('untaught or invalid prerequisites become explicit gaps instead of assumed knowledge', () => {
  const context = buildCourseContinuityContext({
    topics: [
      { _id: 'current', title: 'Current Topic', sequence_index: 1, prerequisites: ['future'] },
      { _id: 'future', title: 'Future Dependency', sequence_index: 2 },
    ],
    currentTopicId: 'current',
    taughtTopicIds: [],
  })

  assert.deepEqual(context.retrieval_scope.priorTopicIds, [])
  assert.deepEqual(context.retrieval_scope.invalidPrerequisiteIds, ['future'])
  assert.deepEqual(context.unmet_prerequisites, ['Future Dependency'])
  assert.match(formatCourseContinuityContext(context), /Do not claim the learner already knows/)
})
