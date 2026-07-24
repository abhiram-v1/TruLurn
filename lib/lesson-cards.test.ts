import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifyLessonCalloutLabel,
  findUnlabelledCodeFences,
  findUnsupportedLessonCallouts,
  hasInventedLessonCardContainer,
  SANCTIONED_LESSON_CARD_DIRECTIVE,
} from './lesson-cards.ts'

test('recognizes only the three sanctioned labels for new generation', () => {
  assert.equal(classifyLessonCalloutLabel('Definition:', { allowLegacy: false }), 'definition')
  assert.equal(classifyLessonCalloutLabel('Example:', { allowLegacy: false }), 'example')
  assert.equal(classifyLessonCalloutLabel('Lock this in:', { allowLegacy: false }), 'insight')
  assert.equal(classifyLessonCalloutLabel('Pro tip:', { allowLegacy: false }), null)
  assert.equal(classifyLessonCalloutLabel('Remember:', { allowLegacy: false }), null)
})

test('keeps legacy stored lessons readable without sanctioning legacy generation', () => {
  assert.equal(classifyLessonCalloutLabel('Key insight:'), 'insight')
  assert.equal(classifyLessonCalloutLabel('Formal definition:'), 'definition')
  assert.deepEqual(findUnsupportedLessonCallouts('> **Key insight:** Keep this.'), ['Key insight'])
})

test('detects invented callout labels and custom card containers', () => {
  const markdown = [
    '> **Definition:** A valid definition.',
    '> **Pro tip:** An invented card.',
    '> **Warning:** Another invented card.',
  ].join('\n\n')
  assert.deepEqual(findUnsupportedLessonCallouts(markdown), ['Pro tip', 'Warning'])
  assert.equal(hasInventedLessonCardContainer(':::note\nCustom card\n:::'), true)
  assert.equal(hasInventedLessonCardContainer('<aside class="rainbow-card">Hi</aside>'), true)
})

test('requires explicit languages for fenced code cards', () => {
  assert.equal(findUnlabelledCodeFences('```python\nprint(1)\n```'), 0)
  assert.equal(findUnlabelledCodeFences('```\nprint(1)\n```'), 1)
})

test('writer directive defines purpose and exact syntax for the four approved treatments', () => {
  assert.match(SANCTIONED_LESSON_CARD_DIRECTIVE, /> \*\*Definition:\*\*/)
  assert.match(SANCTIONED_LESSON_CARD_DIRECTIVE, /> \*\*Example:\*\*/)
  assert.match(SANCTIONED_LESSON_CARD_DIRECTIVE, /> \*\*Lock this in:\*\*/)
  assert.match(SANCTIONED_LESSON_CARD_DIRECTIVE, /fenced code block with an explicit language/i)
  assert.match(SANCTIONED_LESSON_CARD_DIRECTIVE, /never invent a card name, color, icon, wrapper/i)
  assert.match(SANCTIONED_LESSON_CARD_DIRECTIVE, /Most pages need one or two cards/i)
})
