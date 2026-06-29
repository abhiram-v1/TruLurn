import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateQuizForGraph, type CourseTopicSnapshot, type QuizEvaluationEvent } from './graphEvaluator.ts'

function baseEvent(overrides: Partial<QuizEvaluationEvent> = {}): QuizEvaluationEvent {
  return {
    topicId: 'topic-a',
    topicTitle: 'Topic A',
    passed: true,
    overallLevel: 5,
    hasFalseConfidence: false,
    questionsCount: 3,
    weakGaps: [],
    ...overrides,
  }
}

// No AI provider is configured in the test environment, so the "recommend the
// next topic" call inside evaluateQuizForGraph fails fast and falls back to
// its deterministic defaults — exercising the same graceful-failure path the
// function already relies on in production when the model call errors.

test('a strong pass (resulting state mastered) unlocks a dependent whose only prerequisite is satisfied', async () => {
  const courseTopics: CourseTopicSnapshot[] = [
    { id: 'topic-a', title: 'Topic A', state: 'active', mastery: 0, prerequisites: [] },
    { id: 'topic-b', title: 'Topic B', state: 'locked', mastery: 0, prerequisites: ['topic-a'] },
  ]
  const result = await evaluateQuizForGraph(baseEvent({ overallLevel: 5, passed: true }), courseTopics)
  assert.deepEqual(result.unlocked, ['topic-b'])
})

test('a passing-but-weak result (resulting state partial) does not unlock dependents', async () => {
  // overallLevel 2 maps to 'partial', not mastered/functional — a raw `passed`
  // flag at this level must not be treated as satisfying the prerequisite.
  const courseTopics: CourseTopicSnapshot[] = [
    { id: 'topic-a', title: 'Topic A', state: 'active', mastery: 0, prerequisites: [] },
    { id: 'topic-b', title: 'Topic B', state: 'locked', mastery: 0, prerequisites: ['topic-a'] },
  ]
  const result = await evaluateQuizForGraph(baseEvent({ overallLevel: 2, passed: true }), courseTopics)
  assert.deepEqual(result.unlocked, [])
})

test('an already-mastered prerequisite still unlocks dependents regardless of the current event', async () => {
  const courseTopics: CourseTopicSnapshot[] = [
    { id: 'topic-a', title: 'Topic A', state: 'active', mastery: 0, prerequisites: [] },
    { id: 'topic-x', title: 'Topic X', state: 'mastered', mastery: 100, prerequisites: [] },
    { id: 'topic-y', title: 'Topic Y', state: 'locked', mastery: 0, prerequisites: ['topic-x'] },
  ]
  const result = await evaluateQuizForGraph(baseEvent({ overallLevel: 2 }), courseTopics)
  assert.deepEqual(result.unlocked, ['topic-y'])
})

test('the evaluated topic always gets a deterministic state/mastery update', async () => {
  const result = await evaluateQuizForGraph(baseEvent({ topicId: 'topic-a', overallLevel: 4 }), [
    { id: 'topic-a', title: 'Topic A', state: 'active', mastery: 0, prerequisites: [] },
  ])
  assert.deepEqual(result.updates[0], {
    topicId: 'topic-a',
    state: 'functional',
    mastery: 80,
    misconception: false,
    suggested: false,
  })
})
