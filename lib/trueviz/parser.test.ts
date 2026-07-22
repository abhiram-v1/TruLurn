import assert from 'node:assert/strict'
import test from 'node:test'
import { parseTruViz } from './parser.ts'

test('accepts a valid 2D coordinate vector diagram', () => {
  const result = parseTruViz(JSON.stringify({
    type: 'coordinate-vectors',
    dimensions: 2,
    vectors: [{ from: [0, 0], to: [3, 4], label: 'v' }],
    points: [{ at: [3, 4], label: 'head' }],
  }))

  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.spec.type, 'coordinate-vectors')
})

test('accepts 3D tuples and rejects dimension mismatches', () => {
  const valid = parseTruViz(JSON.stringify({
    type: 'coordinate-vectors',
    dimensions: 3,
    vectors: [{ to: [2, 1, 3] }],
  }))
  const invalid = parseTruViz(JSON.stringify({
    type: 'coordinate-vectors',
    dimensions: 3,
    vectors: [{ to: [2, 1] }],
  }))

  assert.equal(valid.ok, true)
  assert.equal(invalid.ok, false)
  if (!invalid.ok) assert.match(invalid.error, /3D numeric "to" tuple/)
})

test('limits coordinate vector diagrams to safe bounded collections', () => {
  const result = parseTruViz(JSON.stringify({
    type: 'coordinate-vectors',
    dimensions: 2,
    vectors: Array.from({ length: 13 }, () => ({ to: [1, 1] })),
  }))

  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /1 to 12 vectors/)
})
