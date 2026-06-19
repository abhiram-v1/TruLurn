import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('source profile preserves academic signals without taking over the persona voice', () => {
  const source = readFileSync(new URL('./sourceProfile.ts', import.meta.url), 'utf8')

  assert.match(source, /active TruLurn persona owns the explanation and voice/i)
  assert.match(source, /Preserve the field\/source terminology/i)
  assert.match(source, /exam-oriented/i)
  assert.doesNotMatch(source, /write as if taught by the same instructor/i)
  assert.doesNotMatch(source, /`- Tone:/i)
})
