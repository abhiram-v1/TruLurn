import assert from 'node:assert/strict'
import test from 'node:test'
import { retrieveAppKnowledge, shouldRetrieveAppKnowledge } from './appKnowledge.ts'

// App-knowledge retrieval lets the agent answer "how does this product work"
// questions from a trusted, hand-written knowledge base instead of guessing.
// These tests pin the gate (when it fires) and the ranking (what it returns).

test('shouldRetrieveAppKnowledge fires on strong product markers', () => {
  assert.equal(shouldRetrieveAppKnowledge('what is trulurn'), true)
  assert.equal(shouldRetrieveAppKnowledge('tell me about the atlas'), true)
  assert.equal(shouldRetrieveAppKnowledge('how does recall work in this app'), true)
})

test('shouldRetrieveAppKnowledge needs product framing for ambiguous terms', () => {
  // "graph" alone could be a course concept; only with app framing is it a product question.
  assert.equal(shouldRetrieveAppKnowledge('this graph'), true)
  assert.equal(shouldRetrieveAppKnowledge('explain the graph of this function'), true)
})

test('shouldRetrieveAppKnowledge stays out of pure subject questions', () => {
  assert.equal(shouldRetrieveAppKnowledge('what is recursion'), false)
  assert.equal(shouldRetrieveAppKnowledge('explain gradient descent'), false)
  assert.equal(shouldRetrieveAppKnowledge(''), false)
})

test('a broad product question ranks the overview entry first', () => {
  const results = retrieveAppKnowledge('what is trulurn')
  assert.ok(results.length >= 1 && results.length <= 4)
  assert.equal(results[0].id, 'product-overview')
})

test('a feature-specific question ranks that feature first', () => {
  assert.equal(retrieveAppKnowledge('recall break')[0].id, 'recall-breaks')
  assert.equal(retrieveAppKnowledge('spaced review')[0].id, 'spaced-reviews')
})

test('retrieval returns nothing for unrelated gibberish', () => {
  assert.deepEqual(retrieveAppKnowledge('xyzzy plugh frobnicate'), [])
})

test('the limit argument caps the number of entries returned', () => {
  const results = retrieveAppKnowledge('quiz graph recall memory review', 2)
  assert.ok(results.length <= 2)
})
