import assert from 'node:assert/strict'
import test from 'node:test'
import { buildGraphSourceEvidencePackets } from './evidence.ts'
import { runGraphGeneration, type GraphGenerationExecutor } from './orchestrate.ts'
import { buildGraphEdgeStagePrompt, buildGraphNodeStagePrompt } from './prompt.ts'
import { GRAPH_GENERATION_MODEL, GraphGenerationError } from './types.ts'
import { validateGeneratedCourseGraph } from './validate.ts'

function topic(id: string, title: string, sourceAnchor?: string) {
  return {
    id,
    title,
    description: `Learn ${title}.`,
    prerequisites: [],
    prerequisite_strength: {},
    depth: 'medium',
    estimated_pages: 2,
    node_type: 'learning_unit',
    importance: 'core',
    role: id === 'a' ? 'foundation' : 'application',
    spine_candidate: id === 'a',
    spine_level: 0,
    source_coverage: sourceAnchor ? 'covered' : undefined,
    concept_group: sourceAnchor ? 'current' : undefined,
    source_anchor: sourceAnchor,
    children: [],
  }
}

function curriculum(sourceBased = false) {
  return {
    title: 'Test Course',
    source_sequence_policy: sourceBased ? 'preserve_uploaded_source_order' : '',
    branches: [{
      id: 'core',
      title: 'Core',
      description: 'Core ideas',
      sections: [{
        title: 'Foundations',
        topics: [
          topic('a', 'Alpha', sourceBased ? 'Source 1 - Alpha' : undefined),
          topic('b', 'Beta', sourceBased ? 'Source 2 - Beta' : undefined),
        ],
      }],
    }],
  }
}

function graph(sourceBased = false) {
  return {
    branches: [{
      id: 'core',
      title: 'Core',
      state: 'in_progress',
      active_topic_id: 'a',
      topic_count: 2,
      mastered_count: 0,
    }],
    topics: [
      {
        id: 'a',
        branch_id: 'core',
        section: 'Foundations',
        title: 'Alpha',
        position: 0,
        state: 'active',
        parent_id: null,
        path_ids: ['a'],
        path_titles: ['Alpha'],
        depth_level: 0,
        node_type: 'learning_unit',
        is_leaf: true,
        children_count: 0,
        learning_depth: 'standard',
        sequence_index: 0,
        recommended_next_ids: ['b'],
        importance: 'core',
        role: 'foundation',
        spine_candidate: true,
        spine_level: 0,
        prerequisite_strength: {},
        is_optional: false,
        covered_by_node_id: null,
        prerequisites: [],
        depth: 'medium',
        estimated_pages: 2,
        source_refs: sourceBased ? ['source-1'] : [],
      },
      {
        id: 'b',
        branch_id: 'core',
        section: 'Foundations',
        title: 'Beta',
        position: 1,
        state: 'locked',
        parent_id: null,
        path_ids: ['b'],
        path_titles: ['Beta'],
        depth_level: 0,
        node_type: 'learning_unit',
        is_leaf: true,
        children_count: 0,
        learning_depth: 'standard',
        sequence_index: 1,
        recommended_next_ids: [],
        importance: 'core',
        role: 'application',
        spine_candidate: false,
        spine_level: 0,
        prerequisite_strength: {},
        is_optional: false,
        covered_by_node_id: null,
        prerequisites: [],
        depth: 'medium',
        estimated_pages: 2,
        source_refs: sourceBased ? ['source-2'] : [],
      },
    ],
    structural_edges: [{
      from_topic_id: 'a',
      to_topic_id: 'b',
      edge_type: 'recommended',
      reason: sourceBased
        ? 'The source order recommends Alpha before Beta.'
        : 'The approved curriculum recommends Alpha before Beta.',
      source_refs: sourceBased ? ['source-1', 'source-2'] : [],
    }],
  }
}

// A single mapped graph topic, as the node stage emits it (state is added later
// by the orchestrator during assembly, so it is intentionally omitted here).
function graphNode(id: string, title: string, branchId: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    branch_id: branchId,
    section: 'Foundations',
    title,
    position: 0,
    parent_id: null,
    path_ids: [id],
    path_titles: [title],
    depth_level: 0,
    node_type: 'learning_unit',
    is_leaf: true,
    children_count: 0,
    learning_depth: 'standard',
    sequence_index: 0,
    recommended_next_ids: [],
    importance: 'core',
    role: 'foundation',
    spine_candidate: false,
    spine_level: 0,
    prerequisite_strength: {},
    is_optional: false,
    covered_by_node_id: null,
    prerequisites: [],
    depth: 'medium',
    estimated_pages: 2,
    source_refs: [],
    ...extra,
  }
}

function branchOf(user: string) {
  return user.match(/Branch to map: \[([^\]]+)\]/)?.[1] ?? null
}

const sourceText = `Source 1: alpha.md
# Alpha
Alpha is the starting concept. It establishes the vocabulary and basic mechanism.

---

Source 2: beta.md
# Beta
Beta applies Alpha to a concrete task and explains the resulting behavior.`

test('source evidence includes every source and bounded topic excerpts', () => {
  const packets = buildGraphSourceEvidencePackets(curriculum(true), sourceText)
  assert.deepEqual(packets.map((packet) => packet.source_id), ['source-1', 'source-2'])
  assert.ok(packets.every((packet) => packet.headings.length > 0))
  const excerpts = packets.flatMap((packet) =>
    packet.topic_evidence.flatMap((evidence) => evidence.excerpts))
  assert.ok(excerpts.length >= 2)
  assert.ok(excerpts.every((excerpt) => excerpt.text.length <= 900))
  assert.ok(excerpts.reduce((sum, excerpt) => sum + excerpt.text.length, 0) <= 40_000)
})

test('node-stage prompt scopes to one branch and carries prior-branch context', () => {
  const prompt = buildGraphNodeStagePrompt({
    mode: 'ai_teacher',
    branch: { id: 'core', title: 'Core', description: 'Core ideas' },
    branchTopics: [
      { id: 'b', title: 'Beta' } as any,
    ],
    priorNodes: [{ id: 'a', title: 'Alpha', branch_id: 'intro' }],
  })
  assert.match(prompt.system, /curriculum mapper, never a curriculum creator/)
  assert.match(prompt.user, /map ONE branch/)
  assert.match(prompt.user, /Branch to map: \[core\]/)
  assert.match(prompt.user, /already mapped in earlier branches/)
  assert.ok(prompt.user.includes('"a"'))
  assert.equal(prompt.responseSchema.name, 'trulurn_graph_nodes_v2')
})

test('edge-stage prompt fixes the node set and emits only edges', () => {
  const packets = buildGraphSourceEvidencePackets(curriculum(true), sourceText)
  const prompt = buildGraphEdgeStagePrompt({
    mode: 'source_grounded',
    nodes: [graphNode('a', 'Alpha', 'core'), graphNode('b', 'Beta', 'core')],
    sourcePackets: packets,
  })
  assert.match(prompt.user, /Final step: connect the already-mapped nodes/)
  assert.match(prompt.user, /structural_edges/)
  assert.match(prompt.user, /SOURCE-GROUNDED EDGE RULES/)
  assert.equal(prompt.responseSchema.name, 'trulurn_graph_edges_v2')
})

test('accepts a complete AI-generated graph contract', () => {
  const report = validateGeneratedCourseGraph(
    { curriculum: curriculum(), mode: 'ai_teacher' },
    graph(),
  )
  assert.equal(report.valid, true, JSON.stringify(report.issues))
})

test('rejects invented and missing nodes, cycles, and invalid references', () => {
  const candidate = graph()
  candidate.topics[0].prerequisites = ['b']
  candidate.topics[0].prerequisite_strength = { b: 'hard' }
  candidate.topics[1].prerequisites = ['a', 'missing']
  candidate.topics[1].prerequisite_strength = { a: 'hard', missing: 'hard' }
  candidate.topics.push({ ...candidate.topics[1], id: 'invented', title: 'Invented' })

  const report = validateGeneratedCourseGraph(
    { curriculum: curriculum(), mode: 'ai_teacher' },
    candidate,
  )
  assert.equal(report.valid, false)
  assert.ok(report.issues.some((issue) => issue.code === 'invented_topic'))
  assert.ok(report.issues.some((issue) => issue.code === 'invalid_prerequisite_reference'))
  assert.ok(report.issues.some((issue) => issue.code === 'hard_prerequisite_cycle'))
})

test('rejects cycles expressed only through structural prerequisite edges', () => {
  const candidate = graph()
  candidate.structural_edges = [
    {
      from_topic_id: 'a',
      to_topic_id: 'b',
      edge_type: 'prerequisite',
      reason: 'Alpha is required for Beta.',
      source_refs: [],
    },
    {
      from_topic_id: 'b',
      to_topic_id: 'a',
      edge_type: 'prerequisite',
      reason: 'Beta is required for Alpha.',
      source_refs: [],
    },
  ]

  const report = validateGeneratedCourseGraph(
    { curriculum: curriculum(), mode: 'ai_teacher' },
    candidate,
  )
  assert.ok(report.issues.some((issue) => issue.code === 'hard_prerequisite_cycle'))
})

test('rejects invalid branch, recommendation, and coverage references', () => {
  const candidate = graph()
  candidate.branches[0].active_topic_id = 'missing'
  candidate.topics[0].recommended_next_ids = ['missing']
  candidate.topics[1].covered_by_node_id = 'missing'

  const report = validateGeneratedCourseGraph(
    { curriculum: curriculum(), mode: 'ai_teacher' },
    candidate,
  )
  assert.ok(report.issues.some((issue) => issue.code === 'invalid_branch_active_topic'))
  assert.ok(report.issues.some((issue) => issue.code === 'invalid_recommended_reference'))
  assert.ok(report.issues.some((issue) => issue.code === 'invalid_coverage_reference'))
})

test('rejects excessive hard prerequisite fan-in', () => {
  const manyTopics = Array.from({ length: 8 }, (_, index) =>
    topic(`t${index}`, `Topic ${index}`))
  const candidateCurriculum = {
    title: 'Wide Course',
    branches: [{
      id: 'core',
      title: 'Core',
      sections: [{ title: 'Core', topics: manyTopics }],
    }],
  }
  const candidate = graph()
  candidate.topics = manyTopics.map((item, index) => ({
    ...candidate.topics[index === 0 ? 0 : 1],
    id: item.id,
    title: item.title,
    path_ids: [item.id],
    path_titles: [item.title],
    position: index,
    sequence_index: index,
    state: index === 0 ? 'active' : 'locked',
    recommended_next_ids: index < manyTopics.length - 1 ? [`t${index + 1}`] : [],
    prerequisites: index === 7 ? manyTopics.slice(0, 7).map((topicItem) => topicItem.id) : [],
    prerequisite_strength: index === 7
      ? Object.fromEntries(manyTopics.slice(0, 7).map((topicItem) => [topicItem.id, 'hard']))
      : {},
  }))
  candidate.structural_edges = manyTopics.slice(0, -1).map((item, index) => ({
    from_topic_id: item.id,
    to_topic_id: manyTopics[index + 1].id,
    edge_type: 'recommended',
    reason: 'Curriculum recommendation.',
    source_refs: [],
  }))

  const report = validateGeneratedCourseGraph(
    { curriculum: candidateCurriculum, mode: 'ai_teacher' },
    candidate,
  )
  assert.ok(report.issues.some((issue) => issue.code === 'excessive_hard_fan_in'))
})

// Stage discriminator: the node stage and edge stage carry different schemas.
function isNodeStage(request: { responseSchema: { name: string } }) {
  return request.responseSchema.name === 'trulurn_graph_nodes_v2'
}

test('maps nodes per branch, then edges, assembling a valid graph', async () => {
  const stages: string[] = []
  const executor: GraphGenerationExecutor = async (request) => {
    stages.push(isNodeStage(request) ? 'node' : 'edge')
    const text = isNodeStage(request)
      ? JSON.stringify({ topics: [graphNode('a', 'Alpha', 'core'), graphNode('b', 'Beta', 'core')] })
      : JSON.stringify({
          structural_edges: [{
            from_topic_id: 'a',
            to_topic_id: 'b',
            edge_type: 'recommended',
            reason: 'Alpha before Beta.',
            source_refs: [],
          }],
        })
    return { text, provider: 'gemini', model: GRAPH_GENERATION_MODEL }
  }

  const result = await runGraphGeneration({ curriculum: curriculum(), mode: 'ai_teacher' }, executor)
  assert.equal(result.provenance.attempts, 1)
  assert.equal(result.provenance.model, GRAPH_GENERATION_MODEL)
  assert.deepEqual(stages, ['node', 'edge'])
  assert.equal(result.map.validation_report && (result.map.validation_report as any).valid, true)
  // Exactly one teachable leaf is promoted to active during code assembly.
  const active = result.map.topics.filter((topic: any) => topic.state === 'active')
  assert.equal(active.length, 1)
  assert.equal(active[0].id, 'a')
})

function twoBranchCurriculum() {
  return {
    title: 'Two Branch Course',
    branches: [
      { id: 'b1', title: 'First', description: 'First branch', sections: [{ title: 'S', topics: [topic('a', 'Alpha')] }] },
      { id: 'b2', title: 'Second', description: 'Second branch', sections: [{ title: 'S', topics: [topic('c', 'Gamma')] }] },
    ],
  }
}

test('passes earlier branches\' mapped nodes as context to later branch steps', async () => {
  const nodeUserPrompts: Record<string, string> = {}
  const executor: GraphGenerationExecutor = async (request) => {
    if (isNodeStage(request)) {
      const id = branchOf(request.user)!
      nodeUserPrompts[id] = request.user
      const nodeId = id === 'b1' ? 'a' : 'c'
      const title = id === 'b1' ? 'Alpha' : 'Gamma'
      return { text: JSON.stringify({ topics: [graphNode(nodeId, title, id)] }), provider: 'gemini', model: GRAPH_GENERATION_MODEL }
    }
    return {
      text: JSON.stringify({
        structural_edges: [{ from_topic_id: 'a', to_topic_id: 'c', edge_type: 'recommended', reason: 'Alpha before Gamma.', source_refs: [] }],
      }),
      provider: 'gemini',
      model: GRAPH_GENERATION_MODEL,
    }
  }

  const result = await runGraphGeneration({ curriculum: twoBranchCurriculum(), mode: 'ai_teacher' }, executor)
  assert.equal((result.map.validation_report as any).valid, true)
  // First branch sees no prior nodes; the second branch sees the first's node id.
  assert.match(nodeUserPrompts.b1, /None yet — this is the first branch\./)
  assert.ok(nodeUserPrompts.b2.includes('"a"'))
})

test('retries the original step prompt — not a fake repair — after a timeout', async () => {
  const nodeUsers: string[] = []
  let nodeCalls = 0
  const executor: GraphGenerationExecutor = async (request) => {
    if (isNodeStage(request)) {
      nodeCalls += 1
      nodeUsers.push(request.user)
      if (nodeCalls < 2) throw new Error('AI request timed out after 180000ms')
      return { text: JSON.stringify({ topics: [graphNode('a', 'Alpha', 'core'), graphNode('b', 'Beta', 'core')] }), provider: 'gemini', model: GRAPH_GENERATION_MODEL }
    }
    return {
      text: JSON.stringify({ structural_edges: [{ from_topic_id: 'a', to_topic_id: 'b', edge_type: 'recommended', reason: 'Order.', source_refs: [] }] }),
      provider: 'gemini',
      model: GRAPH_GENERATION_MODEL,
    }
  }

  const result = await runGraphGeneration({ curriculum: curriculum(), mode: 'ai_teacher' }, executor)
  assert.equal((result.map.validation_report as any).valid, true)
  assert.equal(nodeCalls, 2)
  // The retry after a timeout reuses the original prompt, not a "fix this" prompt.
  assert.equal(nodeUsers[0], nodeUsers[1])
  assert.ok(!nodeUsers[1].includes('failed deterministic validation'))
})

test('repairs a branch step that returns the wrong node set, with a correction note', async () => {
  const nodeUsers: string[] = []
  let nodeCalls = 0
  const executor: GraphGenerationExecutor = async (request) => {
    if (isNodeStage(request)) {
      nodeCalls += 1
      nodeUsers.push(request.user)
      // First attempt drops a required node; second returns the full set.
      const topics = nodeCalls < 2
        ? [graphNode('a', 'Alpha', 'core')]
        : [graphNode('a', 'Alpha', 'core'), graphNode('b', 'Beta', 'core')]
      return { text: JSON.stringify({ topics }), provider: 'gemini', model: GRAPH_GENERATION_MODEL }
    }
    return {
      text: JSON.stringify({ structural_edges: [{ from_topic_id: 'a', to_topic_id: 'b', edge_type: 'recommended', reason: 'Order.', source_refs: [] }] }),
      provider: 'gemini',
      model: GRAPH_GENERATION_MODEL,
    }
  }

  const result = await runGraphGeneration({ curriculum: curriculum(), mode: 'ai_teacher' }, executor)
  assert.equal((result.map.validation_report as any).valid, true)
  assert.equal(nodeCalls, 2)
  assert.match(nodeUsers[1], /failed deterministic validation/)
})

test('repairs across a second round when the first edge step leaves orphans', async () => {
  let edgeCalls = 0
  const executor: GraphGenerationExecutor = async (request) => {
    if (isNodeStage(request)) {
      return { text: JSON.stringify({ topics: [graphNode('a', 'Alpha', 'core'), graphNode('b', 'Beta', 'core')] }), provider: 'gemini', model: GRAPH_GENERATION_MODEL }
    }
    edgeCalls += 1
    // First edge response connects nothing, leaving both topics orphaned; the
    // second round supplies a real edge.
    const structural_edges = edgeCalls < 2
      ? []
      : [{ from_topic_id: 'a', to_topic_id: 'b', edge_type: 'recommended', reason: 'Order.', source_refs: [] }]
    return { text: JSON.stringify({ structural_edges }), provider: 'gemini', model: GRAPH_GENERATION_MODEL }
  }

  const result = await runGraphGeneration({ curriculum: curriculum(), mode: 'ai_teacher' }, executor)
  assert.equal((result.map.validation_report as any).valid, true)
  assert.equal(result.provenance.attempts, 2)
  assert.equal(edgeCalls, 2)
})

test('fails with a resumable error after exhausting a step\'s attempts', async () => {
  let calls = 0
  const executor: GraphGenerationExecutor = async (request) => {
    calls += 1
    // Node step never returns the required node set.
    return { text: JSON.stringify({ topics: [] }), provider: 'gemini', model: GRAPH_GENERATION_MODEL }
  }

  await assert.rejects(
    runGraphGeneration({ curriculum: curriculum(), mode: 'ai_teacher' }, executor),
    (error: unknown) => {
      assert.ok(error instanceof GraphGenerationError)
      assert.equal(error.code, 'GRAPH_GENERATION_FAILED')
      assert.equal(error.attempts, 3)
      return true
    },
  )
  assert.equal(calls, 3)
})

test('rejects any executor result that violates fixed Gemini ownership', async () => {
  let calls = 0
  const executor: GraphGenerationExecutor = async () => {
    calls += 1
    return { text: JSON.stringify({ topics: [graphNode('a', 'Alpha', 'core'), graphNode('b', 'Beta', 'core')] }), provider: 'openai', model: 'gpt-5.4-mini' }
  }

  await assert.rejects(
    runGraphGeneration({ curriculum: curriculum(), mode: 'ai_teacher' }, executor),
    (error: unknown) => {
      assert.ok(error instanceof GraphGenerationError)
      assert.match(error.message, /gemini-3\.1-flash-lite/)
      return true
    },
  )
  // Three attempts on the first (node) step, then it gives up before reaching edges.
  assert.equal(calls, 3)
})

test('passes a graph-specific timeout override to every step', async () => {
  const timeouts: Array<number | undefined> = []
  const executor: GraphGenerationExecutor = async (request) => {
    timeouts.push(request.timeoutMs)
    if (isNodeStage(request)) {
      return { text: JSON.stringify({ topics: [graphNode('a', 'Alpha', 'core'), graphNode('b', 'Beta', 'core')] }), provider: 'gemini', model: GRAPH_GENERATION_MODEL }
    }
    return {
      text: JSON.stringify({ structural_edges: [{ from_topic_id: 'a', to_topic_id: 'b', edge_type: 'recommended', reason: 'Order.', source_refs: [] }] }),
      provider: 'gemini',
      model: GRAPH_GENERATION_MODEL,
    }
  }

  await runGraphGeneration({ curriculum: curriculum(), mode: 'ai_teacher' }, executor)
  assert.ok(timeouts.length >= 2)
  assert.ok(timeouts.every((value) => typeof value === 'number' && value! >= 120_000))
})

test('does not retry an aborted graph request', async () => {
  const controller = new AbortController()
  let calls = 0
  const executor: GraphGenerationExecutor = async () => {
    calls += 1
    controller.abort()
    throw new Error('aborted')
  }

  await assert.rejects(
    runGraphGeneration(
      { curriculum: curriculum(), mode: 'ai_teacher', signal: controller.signal },
      executor,
    ),
    /aborted/,
  )
  assert.equal(calls, 1)
})
