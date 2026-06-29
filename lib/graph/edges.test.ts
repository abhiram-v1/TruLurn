import assert from 'node:assert/strict'
import test from 'node:test'
import {
  dependencyAdjacency,
  dependencyReverseAdjacency,
  isHardPrerequisite,
  longestDependencyPath,
  requiredUnmetPath,
} from './edges.ts'

function edge(from: string, to: string, edgeType: string, prereqStrength: 'hard' | 'soft' | null = null) {
  return { from, to, edgeType, prereqStrength }
}

test('isHardPrerequisite excludes sequence, soft prerequisites, and other edge types', () => {
  assert.equal(isHardPrerequisite(edge('a', 'b', 'prerequisite', 'hard')), true)
  assert.equal(isHardPrerequisite(edge('a', 'b', 'prerequisite', null)), true) // null/missing defaults to hard
  assert.equal(isHardPrerequisite(edge('a', 'b', 'prerequisite', 'soft')), false)
  assert.equal(isHardPrerequisite(edge('a', 'b', 'sequence')), false)
  assert.equal(isHardPrerequisite(edge('a', 'b', 'recommended')), false)
  assert.equal(isHardPrerequisite(edge('a', 'b', 'semantic')), false)
})

test('dependencyAdjacency and its reverse ignore sequence edges entirely', () => {
  const edges = [
    edge('a', 'b', 'prerequisite', 'hard'),
    edge('b', 'c', 'sequence'), // ordering only — must not appear as a dependency
    edge('a', 'c', 'prerequisite', 'soft'), // soft — also not a hard dependency
  ]
  const fwd = dependencyAdjacency(edges, ['a', 'b', 'c'])
  assert.deepEqual(fwd.get('a'), ['b'])
  assert.deepEqual(fwd.get('b'), [])
  assert.deepEqual(fwd.get('c'), [])

  const rev = dependencyReverseAdjacency(edges, ['a', 'b', 'c'])
  assert.deepEqual(rev.get('b'), ['a'])
  assert.deepEqual(rev.get('c'), [])
})

test('requiredUnmetPath stops at the boundary of already-satisfied prerequisites', () => {
  // a(satisfied) -> b(unmet) -> c(unmet) -> target ; plus a separate satisfied root x -> b
  const edges = [
    edge('a', 'b', 'prerequisite', 'hard'),
    edge('b', 'c', 'prerequisite', 'hard'),
    edge('c', 'target', 'prerequisite', 'hard'),
  ]
  const satisfied = new Set(['a'])
  const result = requiredUnmetPath({
    targetId: 'target',
    edges,
    isSatisfied: (id) => satisfied.has(id),
  })
  // a is included as the satisfied boundary, but nothing upstream of a is walked.
  assert.deepEqual([...result.nodes].sort(), ['a', 'b', 'c', 'target'])
  assert.deepEqual([...result.edges].sort(), ['a::b', 'b::c', 'c::target'])
})

test('requiredUnmetPath ignores sequence edges even when they point at the target chain', () => {
  const edges = [
    edge('a', 'target', 'sequence'), // ordering hint only
    edge('b', 'target', 'prerequisite', 'hard'),
  ]
  const result = requiredUnmetPath({
    targetId: 'target',
    edges,
    isSatisfied: () => false,
  })
  assert.deepEqual([...result.nodes].sort(), ['b', 'target'])
  assert.deepEqual([...result.edges], ['b::target'])
})

test('requiredUnmetPath returns just the target when there are no unmet hard prerequisites', () => {
  const result = requiredUnmetPath({ targetId: 'solo', edges: [], isSatisfied: () => false })
  assert.deepEqual([...result.nodes], ['solo'])
  assert.equal(result.edges.size, 0)
})

test('longestDependencyPath finds the longest hard-prerequisite chain, ignoring sequence/soft', () => {
  const edges = [
    edge('a', 'b', 'prerequisite', 'hard'),
    edge('b', 'c', 'prerequisite', 'hard'),
    edge('c', 'd', 'prerequisite', 'hard'),
    edge('x', 'd', 'sequence'), // longer-looking path via sequence must not count
    edge('y', 'd', 'prerequisite', 'soft'), // soft must not count
  ]
  const path = longestDependencyPath(['a', 'b', 'c', 'd', 'x', 'y'], edges)
  assert.deepEqual(path, ['a', 'b', 'c', 'd'])
})

test('longestDependencyPath returns empty when there are no hard prerequisites', () => {
  assert.deepEqual(longestDependencyPath(['a', 'b'], [edge('a', 'b', 'sequence')]), [])
  assert.deepEqual(longestDependencyPath(['a'], []), [])
})
