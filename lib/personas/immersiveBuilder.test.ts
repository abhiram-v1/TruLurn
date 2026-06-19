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

test('lesson directives combine intellectual energy with academic mastery', () => {
  const directive = buildImmersiveBuilderDirective({
    surface: 'lesson',
    lesson: {
      contentKind: 'full_page',
      sequenceRole: 'introduce',
      pageNumber: 1,
      topicDepth: 'critical',
    },
  })
  assert.match(directive, /genuine intellectual excitement/i)
  assert.match(directive, /canonical term/i)
  assert.match(directive, /academically reliable definition/i)
  assert.match(directive, /"Remember" or "TL;DR"/i)
  assert.match(directive, /formal definition and the few points worth retaining/i)
  assert.doesNotMatch(directive, /Exam and interview ready/i)
  assert.match(directive, /at most two short opening paragraphs/i)
  assert.match(directive, /within roughly the first 150 words/i)
  assert.match(directive, /> \*\*Definition:\*\*/i)
  assert.match(directive, /Do not follow it with a glossary-style bullet list/i)
  assert.match(directive, /> \*\*Remember:\*\*/i)
  assert.match(directive, /worked example/i)
  assert.match(directive, /without wandering into a broader syllabus/i)
  assert.ok(directive.length < 6500)
})

test('agent, quiz, and recall share the same persona philosophy', () => {
  for (const surface of ['agent', 'quiz', 'recall'] as const) {
    const directive = buildImmersiveBuilderDirective({ surface })
    assert.match(directive, /Immersive Builder/)
    assert.match(directive, /awaken interest, build understanding, establish precision/i)
    assert.match(directive, /authentic vocabulary/i)
  }
})
