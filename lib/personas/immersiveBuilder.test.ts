import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildImmersiveBuilderDirective,
  selectImmersiveBuilderPageType,
} from './immersiveBuilder.ts'
import { buildPersonaDirective } from './index.ts'

test('selects an adaptive lesson path instead of one fixed arc', () => {
  assert.equal(selectImmersiveBuilderPageType({
    contentKind: 'full_page',
    sequenceRole: 'introduce',
    pageNumber: 1,
  }), 'major_concept')
  assert.equal(selectImmersiveBuilderPageType({
    contentKind: 'bridge',
    sequenceRole: 'connect',
  }), 'continuation')
  assert.equal(selectImmersiveBuilderPageType({
    contentKind: 'section',
    targetLength: 'short',
  }), 'support')
  assert.equal(selectImmersiveBuilderPageType({
    focus: 'Derive the gradient equation',
  }), 'mathematical')
})

test('lesson writing uses the shared minimal teaching directive instead of a persona', () => {
  const directive = buildPersonaDirective({
    persona: 'immersive_builder',
    surface: 'lesson',
    lesson: {
      contentKind: 'full_page',
      sequenceRole: 'introduce',
      pageNumber: 1,
      topicDepth: 'critical',
    },
  })
  assert.match(directive, /warm professor who is genuinely interested/i)
  assert.match(directive, /canonical terminology/i)
  assert.match(directive, /formal meaning/i)
  assert.match(directive, /Do not greet the learner/i)
  assert.doesNotMatch(directive, /Immersive Builder|PAGE PATH/i)
  assert.ok(directive.length < 1000)
})

test('agent, quiz, and recall share the same persona philosophy', () => {
  for (const surface of ['agent', 'quiz', 'recall'] as const) {
    const directive = buildImmersiveBuilderDirective({ surface })
    assert.match(directive, /Immersive Builder/)
    assert.match(directive, /awaken interest/i)
  }
})
