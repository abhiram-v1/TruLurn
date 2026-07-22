import assert from 'node:assert/strict'
import test from 'node:test'
import {
  COMPACT_VECTOR_OUTPUT_CONTRACT,
  VECTOR_DIAGRAM_EMBEDDING_INSTRUCTIONS,
} from './vectorDiagram.ts'

test('vector generation contract teaches the renderer schema and bans ASCII sketches', () => {
  assert.match(COMPACT_VECTOR_OUTPUT_CONTRACT, /"type":"coordinate-vectors"/)
  assert.match(COMPACT_VECTOR_OUTPUT_CONTRACT, /"dimensions":2/)
  assert.match(COMPACT_VECTOR_OUTPUT_CONTRACT, /Never draw coordinate diagrams with ASCII/i)
  assert.match(VECTOR_DIAGRAM_EMBEDDING_INSTRUCTIONS, /tail.*head/i)
  assert.match(VECTOR_DIAGRAM_EMBEDDING_INSTRUCTIONS, /3D/)
})
