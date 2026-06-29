import assert from 'node:assert/strict'
import test from 'node:test'
import { dropTeachableTopicsWithoutEvidence } from './mongoPersistence.ts'

function teachable(id: string, sourceRefs: string[]) {
  return { _id: id, title: id, node_type: 'learning_unit', source_refs: sourceRefs }
}

function container(id: string) {
  return { _id: id, title: id, node_type: 'container', source_refs: [] }
}

test('drops teachable topics with zero resolvable source_refs', () => {
  const result = dropTeachableTopicsWithoutEvidence([
    teachable('a', ['s1:1']),
    teachable('b', []),
  ])
  assert.deepEqual(result.topics.map((t) => t._id), ['a'])
  assert.deepEqual(result.dropped, ['b'])
})

test('never drops a container even with empty source_refs', () => {
  const result = dropTeachableTopicsWithoutEvidence([
    container('root'),
    teachable('leaf', ['s1:1']),
  ])
  assert.deepEqual(result.topics.map((t) => t._id), ['root', 'leaf'])
  assert.deepEqual(result.dropped, [])
})

test('keeps everything when every teachable topic has evidence', () => {
  const result = dropTeachableTopicsWithoutEvidence([
    teachable('a', ['s1:1']),
    teachable('b', ['s1:2']),
  ])
  assert.equal(result.topics.length, 2)
  assert.deepEqual(result.dropped, [])
})

test('drops every teachable topic when none have evidence, leaving only containers', () => {
  const result = dropTeachableTopicsWithoutEvidence([
    container('root'),
    teachable('a', []),
    teachable('b', []),
  ])
  assert.deepEqual(result.topics.map((t) => t._id), ['root'])
  assert.deepEqual(result.dropped, ['a', 'b'])
})
