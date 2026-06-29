import assert from 'node:assert/strict'
import test from 'node:test'
import { transformToGraphData, type RawBranch, type RawTopic, type RawTopicEdge } from './transform.ts'

const BRANCH: RawBranch = {
  _id: 'branch-core',
  branch_key: 'core',
  course_id: 'course-1',
  title: 'Core',
  state: 'in_progress',
  active_topic_id: 'a',
  topic_count: 4,
  mastered_count: 1,
}

function topic(overrides: Partial<RawTopic> & { _id: string; state: string }): RawTopic {
  return {
    course_id: 'course-1',
    branch_id: 'core',
    section: 'Core',
    title: overrides._id,
    position: 0,
    node_type: 'learning_unit',
    children_count: 0,
    created_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

test('criticalPath follows only hard prerequisites, never a sequence edge', () => {
  // a -> b -> c via hard prerequisites; c -> d via a sequence edge only.
  // If sequence were (wrongly) treated as a dependency, the longest chain
  // would extend through d (length 4); the true hard-prereq spine stops at c.
  const topics: RawTopic[] = [
    topic({ _id: 'a', state: 'locked' }),
    topic({ _id: 'b', state: 'locked', prerequisites: ['a'] }),
    topic({ _id: 'c', state: 'locked', prerequisites: ['b'] }),
    topic({ _id: 'd', state: 'locked' }),
  ]
  const topicEdges: RawTopicEdge[] = [
    { from_topic_id: 'c', to_topic_id: 'd', edge_type: 'sequence' },
  ]

  const data = transformToGraphData({
    courseId: 'course-1',
    courseTitle: 'Test Course',
    topics,
    branches: [BRANCH],
    topicEdges,
  })

  assert.deepEqual(data.criticalPath, ['a', 'b', 'c'])
  assert.ok(!data.criticalPath.includes('d'))
})

test('knowledgeStrength does not inflate locked or active nodes with phantom freshness', () => {
  const topics: RawTopic[] = [
    topic({ _id: 'locked-topic', state: 'locked' }),
    topic({ _id: 'active-topic', state: 'active' }),
  ]

  const data = transformToGraphData({
    courseId: 'course-1',
    courseTitle: 'Test Course',
    topics,
    branches: [BRANCH],
    topicEdges: [],
  })

  const locked = data.nodes.find((n) => n.id === 'locked-topic')!
  const active = data.nodes.find((n) => n.id === 'active-topic')!
  // Before the fix these picked up +20 from a flat decayScore=100 default.
  assert.equal(locked.knowledgeStrength, 0)
  assert.equal(active.knowledgeStrength, 4)
})

test('a sequence-only predecessor does not block unlock readiness', () => {
  // a -> b is a real hard prerequisite (a already mastered, so b is solid).
  // p -> q is a real hard prerequisite (p locked, so q is NOT solid).
  // b -> p is a sequence edge only (study order), not a dependency.
  // If sequence were wrongly treated as a dependency, p would inherit an unmet
  // "prerequisite" on locked b and lose to b for next-best; p's real edge to a
  // locked q gives it strictly higher downstream impact once correctly unblocked.
  const topics: RawTopic[] = [
    topic({ _id: 'a', state: 'mastered', understanding_level: 5 }),
    topic({ _id: 'b', state: 'locked', prerequisites: ['a'] }),
    topic({ _id: 'p', state: 'locked' }),
    topic({ _id: 'q', state: 'locked', prerequisites: ['p'] }),
  ]
  const topicEdges: RawTopicEdge[] = [
    { from_topic_id: 'b', to_topic_id: 'p', edge_type: 'sequence' },
  ]

  const data = transformToGraphData({
    courseId: 'course-1',
    courseTitle: 'Test Course',
    topics,
    branches: [BRANCH],
    topicEdges,
  })

  assert.equal(data.nextBestNodeId, 'p')
})

test('vulnerability risk keeps propagating after a node is reached by a second, higher-risk path', () => {
  // mid starts with only its own small "active" risk; weak_root boosts it
  // moderately via a direct edge. strong_root reaches the SAME node (mid) via
  // a second, longer path (through relay) with a much larger risk. Topics are
  // ordered so mid and target are dequeued and produce their first
  // (low-risk) propagation before the stronger path arrives — exactly the
  // ordering that exposed the bug: a `visited` guard would freeze target's
  // risk at the first, weak propagation and never let mid's later, much
  // larger risk reach it.
  const topics: RawTopic[] = [
    topic({ _id: 'mid', state: 'active', prerequisites: ['weak_root', 'relay'] }),
    topic({ _id: 'target', state: 'locked', prerequisites: ['mid'] }),
    topic({ _id: 'weak_root', state: 'partial' }),
    topic({ _id: 'relay', state: 'locked', prerequisites: ['strong_root'] }),
    topic({ _id: 'strong_root', state: 'unstable' }),
  ]

  const data = transformToGraphData({
    courseId: 'course-1',
    courseTitle: 'Test Course',
    topics,
    branches: [BRANCH],
    topicEdges: [],
  })

  const target = data.nodes.find((n) => n.id === 'target')!
  // The frozen-on-first-touch bug converges target to ~6 (only weak_root's
  // contribution, decayed twice). The correct relaxation converges to ~38
  // once strong_root's much larger risk reaches mid and re-propagates.
  assert.ok(
    target.vulnerabilityRisk > 25,
    `expected target's risk to reflect the stronger path (>25), got ${target.vulnerabilityRisk}`,
  )
})

test('an edge touching a container is redirected to its nearest teachable descendant, not dropped', () => {
  // branch-root is a container (it has children), so it never gets rendered
  // as its own card. 'external' has a hard prerequisite on branch-root — that
  // relationship must survive by redirecting to child-a (branch-root's first
  // teachable descendant), not silently vanish because the container itself
  // is absent from the rendered node set.
  const topics: RawTopic[] = [
    topic({ _id: 'branch-root', state: 'locked' }),
    topic({ _id: 'child-a', state: 'locked', parent_id: 'branch-root' }),
    topic({ _id: 'child-b', state: 'locked', parent_id: 'branch-root' }),
    topic({ _id: 'external', state: 'locked', prerequisites: ['branch-root'] }),
  ]

  const data = transformToGraphData({
    courseId: 'course-1',
    courseTitle: 'Test Course',
    topics,
    branches: [BRANCH],
    topicEdges: [],
  })

  assert.ok(!data.nodes.some((n) => n.id === 'branch-root'), 'branch-root should not render as its own card')
  assert.ok(
    data.edges.some((e) => e.from === 'child-a' && e.to === 'external'),
    `expected an edge redirected to child-a, got ${JSON.stringify(data.edges)}`,
  )
  assert.ok(!data.edges.some((e) => e.from === 'branch-root' || e.to === 'branch-root'))
})

test('does not render both directions of the same pair as two opposite arrows', () => {
  // 'a' has a hard prerequisite on 'b' (b -> a) and also lists 'b' as a
  // recommended next step (a -> b) — same unordered pair, opposite
  // directions, different edge types. Only the higher-priority direction
  // (the real prerequisite) should survive.
  const topics: RawTopic[] = [
    topic({ _id: 'b', state: 'locked' }),
    topic({ _id: 'a', state: 'locked', prerequisites: ['b'], recommended_next_ids: ['b'] }),
  ]

  const data = transformToGraphData({
    courseId: 'course-1',
    courseTitle: 'Test Course',
    topics,
    branches: [BRANCH],
    topicEdges: [],
  })

  assert.ok(data.edges.some((e) => e.from === 'b' && e.to === 'a' && e.edgeType === 'prerequisite'))
  assert.ok(!data.edges.some((e) => e.from === 'a' && e.to === 'b'))
})
