import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveDeterministicOrder } from './sourceOrderingHeuristics.ts'

const block = (index: number, title: string) => ({ index, title, body: 'x', raw: 'x' })

test('derives order from explicit sequence numbers', () => {
  const order = deriveDeterministicOrder([
    block(1, 'Chapter 2: Trees'),
    block(2, 'Chapter 1: Intro'),
    block(3, 'Chapter 3: Graphs'),
  ])
  assert.deepEqual(order, [2, 1, 3])
})

test('handles lecture and leading-number filenames', () => {
  assert.deepEqual(
    deriveDeterministicOrder([block(1, 'Lecture02.pdf'), block(2, 'Lecture01.pdf')]),
    [2, 1],
  )
  assert.deepEqual(
    deriveDeterministicOrder([
      block(7, '03 - Recursion'),
      block(9, '01 - Basics'),
      block(4, '02 - Loops'),
    ]),
    [9, 4, 7],
  )
})

test('returns null when ordering is ambiguous', () => {
  assert.equal(
    deriveDeterministicOrder([block(1, 'Introduction'), block(2, 'Advanced Topics')]),
    null,
  )
})

test('returns null on duplicate sequence numbers', () => {
  assert.equal(deriveDeterministicOrder([block(1, 'Unit 1'), block(2, 'Unit 1')]), null)
})
