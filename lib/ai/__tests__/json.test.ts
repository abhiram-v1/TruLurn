import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseAIJson } from '../json.ts'

test('parses a bare JSON object', () => {
  assert.deepEqual(parseAIJson('{"a":1}'), { a: 1 })
})

test('strips a ```json fenced block', () => {
  const text = '```json\n{"a":1,"b":"two"}\n```'
  assert.deepEqual(parseAIJson(text), { a: 1, b: 'two' })
})

test('extracts a JSON object from surrounding prose', () => {
  const text = 'Sure, here is the result:\n{"ok":true}\nLet me know if you need more.'
  assert.deepEqual(parseAIJson(text), { ok: true })
})

test('parses a top-level JSON array', () => {
  assert.deepEqual(parseAIJson('[1,2,3]'), [1, 2, 3])
})

test('prefers an array when it appears before any object brace', () => {
  const text = '[{"id":1},{"id":2}]'
  assert.deepEqual(parseAIJson(text), [{ id: 1 }, { id: 2 }])
})

test('throws a descriptive error when no JSON is present', () => {
  assert.throws(() => parseAIJson('no json here at all'), /did not contain a valid JSON/)
})
