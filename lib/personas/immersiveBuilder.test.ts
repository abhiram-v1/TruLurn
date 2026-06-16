import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildImmersiveBuilderDirective,
  selectImmersiveBuilderPageType,
} from './immersiveBuilder.ts'

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

test('lesson directives contain template-required depth without excessive prompt size', () => {
  const directive = buildImmersiveBuilderDirective({
    surface: 'lesson',
    lesson: {
      contentKind: 'full_page',
      sequenceRole: 'introduce',
      pageNumber: 1,
      topicDepth: 'critical',
    },
  })
  assert.match(directive, /start from meaning, move to precision/i)
  assert.match(directive, /Exam and interview ready/i)
  assert.match(directive, /worked example/i)
  assert.ok(directive.length < 3500)
})

test('agent, quiz, and recall share the same persona philosophy', () => {
  for (const surface of ['agent', 'quiz', 'recall'] as const) {
    const directive = buildImmersiveBuilderDirective({ surface })
    assert.match(directive, /Immersive Builder/)
    assert.match(directive, /start from meaning, move to precision/i)
  }
})
