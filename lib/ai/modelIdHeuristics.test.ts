import assert from 'node:assert/strict'
import test from 'node:test'
import { looksLikeValidModelId } from './modelIdHeuristics.ts'

test('accepts well-formed ids for their own provider', () => {
  assert.equal(looksLikeValidModelId('gemini', 'gemini-3.5-flash'), true)
  assert.equal(looksLikeValidModelId('gemini', 'gemini-2.5-flash-lite'), true)
  assert.equal(looksLikeValidModelId('openai', 'gpt-5.4'), true)
  assert.equal(looksLikeValidModelId('openai', 'gpt-5.4-mini'), true)
  assert.equal(looksLikeValidModelId('openai', 'o4-mini'), true)
  assert.equal(looksLikeValidModelId('openai', 'chatgpt-4o-latest'), true)
})

test('rejects the other provider\'s id pasted into the wrong slot', () => {
  assert.equal(looksLikeValidModelId('gemini', 'gpt-5.4'), false)
  assert.equal(looksLikeValidModelId('openai', 'gemini-3.5-flash'), false)
})

test('rejects empty or malformed values', () => {
  assert.equal(looksLikeValidModelId('gemini', ''), false)
  assert.equal(looksLikeValidModelId('gemini', 'flash-2.5'), false)
  assert.equal(looksLikeValidModelId('openai', 'gp-5.4'), false)
})
