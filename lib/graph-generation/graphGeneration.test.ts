import assert from 'node:assert/strict'
import test from 'node:test'
import { buildGraphSourceEvidencePackets } from './evidence.ts'
import { runGraphGeneration, type GraphGenerationExecutor } from './orchestrate.ts'
import { buildGraphGenerationPrompt } from './prompt.ts'
import { GraphGenerationError } from './types.ts'
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

test('graph prompt encodes the five-stage mapper and strict source boundary', () => {
  const packets = buildGraphSourceEvidencePackets(curriculum(true), sourceText)
  const prompt = buildGraphGenerationPrompt({
    curriculum: curriculum(true),
    mode: 'source_grounded',
    sourceText,
    sourceEvidencePackets: packets,
  })
  assert.match(prompt.system, /1\. CONCEPT EXTRACTION/)
  assert.match(prompt.system, /5\. GRAPH OUTPUT/)
  assert.match(prompt.system, /Never invent, omit, rename, merge, or split/)
  assert.match(prompt.user, /100% of graph nodes/)
  assert.match(prompt.user, /Preserve uploaded source order/)
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

test('repairs an invalid first candidate using Gemini-only graph requests', async () => {
  const requests: Array<{ feature: string; user: string }> = []
  const outputs = [JSON.stringify({ branches: [], topics: [], structural_edges: [] }), JSON.stringify(graph())]
  const executor: GraphGenerationExecutor = async (request) => {
    requests.push({ feature: request.feature, user: request.user })
    return { text: outputs.shift()!, provider: 'gemini', model: 'gemini-3.1-pro-preview' }
  }

  const result = await runGraphGeneration(
    { curriculum: curriculum(), mode: 'ai_teacher' },
    executor,
  )
  assert.equal(result.provenance.attempts, 2)
  assert.equal(result.provenance.provider, 'gemini')
  assert.equal(result.provenance.model, 'gemini-3.1-pro-preview')
  assert.ok(requests.every((request) => request.feature === 'graph_generation'))
  assert.match(requests[1].user, /failed deterministic validation/)
})

test('fails after three invalid Gemini attempts with a resumable error code', async () => {
  let calls = 0
  const executor: GraphGenerationExecutor = async (request) => {
    calls += 1
    assert.equal(request.feature, 'graph_generation')
    return { text: 'not-json', provider: 'gemini', model: 'gemini-3.1-pro-preview' }
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
    return { text: JSON.stringify(graph()), provider: 'openai', model: 'gpt-5.4-mini' }
  }

  await assert.rejects(
    runGraphGeneration({ curriculum: curriculum(), mode: 'ai_teacher' }, executor),
    (error: unknown) => {
      assert.ok(error instanceof GraphGenerationError)
      assert.match(error.message, /gemini-3\.1-pro-preview/)
      return true
    },
  )
  assert.equal(calls, 3)
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
