import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('markdown renderer delegates labels to the centralized lesson-card contract', () => {
  const source = readFileSync(new URL('./MarkdownContent.tsx', import.meta.url), 'utf8')
  assert.match(source, /classifyLessonCalloutLabel/)
  assert.match(source, /data-lesson-card/)
})

test('code fences use the same approved card anatomy', () => {
  const source = readFileSync(new URL('./MarkdownContent.tsx', import.meta.url), 'utf8')
  assert.match(source, /data-lesson-card="code"/)
  assert.match(source, /md-code-heading/)
  assert.match(source, /IconCode/)
})
