import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AI_TEACHER_CURRICULUM_RESPONSE_SCHEMA,
  SOURCE_CURRICULUM_RESPONSE_SCHEMA,
  curriculumResponseSchemaForProvider,
  curriculumResponseSchemaResolver,
  normalizeOpenAIPrerequisiteStrength,
  toOpenAICurriculumResponseSchema,
} from './curriculumSchema.ts'

function walk(node: any, visit: (node: any) => void) {
  if (!node || typeof node !== 'object') return
  visit(node)
  if (Array.isArray(node)) {
    node.forEach((item) => walk(item, visit))
    return
  }
  for (const value of Object.values(node)) walk(value, visit)
}

test('both curriculum schemas preserve recursive topic trees', () => {
  for (const responseSchema of [
    AI_TEACHER_CURRICULUM_RESPONSE_SCHEMA,
    SOURCE_CURRICULUM_RESPONSE_SCHEMA,
  ]) {
    const schema = responseSchema.schema as any
    assert.ok(schema.$defs?.topic_node)
    let refCount = 0
    walk(schema, (node) => {
      if (node['$ref'] === '#/$defs/topic_node') refCount += 1
    })
    assert.ok(refCount >= 2)
  }
})

test('source schema requires stable refs and concept groups only in source mode', () => {
  const sourceTopic = (SOURCE_CURRICULUM_RESPONSE_SCHEMA.schema as any).$defs.topic_node
  const teacherTopic = (AI_TEACHER_CURRICULUM_RESPONSE_SCHEMA.schema as any).$defs.topic_node

  assert.ok(sourceTopic.required.includes('source_refs'))
  assert.ok(sourceTopic.required.includes('concept_group'))
  assert.equal(sourceTopic.properties.source_refs.minItems, 1)
  assert.equal(teacherTopic.properties.source_refs, undefined)
  assert.equal(teacherTopic.properties.concept_group, undefined)
})

test('schemas omit fields hydrated by application code', () => {
  for (const responseSchema of [
    AI_TEACHER_CURRICULUM_RESPONSE_SCHEMA,
    SOURCE_CURRICULUM_RESPONSE_SCHEMA,
  ]) {
    const schema = responseSchema.schema as any
    const topic = schema.$defs.topic_node
    assert.equal(topic.properties.initial_state, undefined)
    assert.equal(topic.properties.source_coverage, undefined)
    assert.equal(topic.properties.source_anchor, undefined)
    assert.equal(schema.properties.out_of_scope, undefined)
    assert.equal(schema.properties.source_limitations, undefined)
    assert.equal(schema.properties.branches.items.properties.state, undefined)
  }
})

test('source sequence policy is source-only', () => {
  assert.ok((SOURCE_CURRICULUM_RESPONSE_SCHEMA.schema as any).required.includes('source_sequence_policy'))
  assert.equal(
    (AI_TEACHER_CURRICULUM_RESPONSE_SCHEMA.schema as any).properties.source_sequence_policy,
    undefined,
  )
})

test('OpenAI dialect closes objects and rewrites prerequisite maps', () => {
  const openai = toOpenAICurriculumResponseSchema('source_grounded')
  assert.equal(openai.strict, true)

  let objectCount = 0
  walk(openai.schema, (node) => {
    const objectType = node.type === 'object'
      || (Array.isArray(node.type) && node.type.includes('object'))
    if (!objectType || !node.properties) return
    objectCount += 1
    assert.equal(node.additionalProperties, false)
    assert.deepEqual(
      [...node.required].sort(),
      Object.keys(node.properties).sort(),
    )
  })
  assert.ok(objectCount >= 5)

  const strength = (openai.schema as any).$defs.topic_node.properties.prerequisite_strength
  assert.equal(strength.type, 'array')
  assert.deepEqual(strength.items.required.sort(), ['strength', 'topic_id'])
})

test('provider resolver enforces strict schema for OpenAI only; Gemini gets none', () => {
  // Confirmed live: Gemini's responseJsonSchema flattens the recursive
  // topic_node $ref (nested children came back at depth 0). Gemini must get
  // `undefined` so it falls back to plain prompted JSON, which nests correctly.
  assert.equal(curriculumResponseSchemaForProvider('gemini', 'source_grounded'), undefined)
  assert.equal(curriculumResponseSchemaForProvider('gemini', 'ai_teacher'), undefined)
  assert.equal(curriculumResponseSchemaResolver('source_grounded')('gemini'), undefined)
  assert.equal(curriculumResponseSchemaResolver('source_grounded')('openai').strict, true)
  assert.equal(curriculumResponseSchemaForProvider('openai', 'source_grounded').strict, true)
})

test('OpenAI prerequisite pairs normalize back to maps recursively', () => {
  const curriculum = {
    branches: [{
      sections: [{
        topics: [{
          prerequisite_strength: [
            { topic_id: 'a', strength: 'hard' },
            { topic_id: 'b', strength: 'soft' },
          ],
          children: [{
            prerequisite_strength: [{ topic_id: 'parent', strength: 'hard' }],
            children: [],
          }],
        }],
      }],
    }],
  }

  normalizeOpenAIPrerequisiteStrength(curriculum)
  const topic = curriculum.branches[0].sections[0].topics[0] as any
  assert.deepEqual(topic.prerequisite_strength, { a: 'hard', b: 'soft' })
  assert.deepEqual(topic.children[0].prerequisite_strength, { parent: 'hard' })
})

test('normalizer tolerates malformed or already-normalized input', () => {
  const curriculum = {
    branches: [{ sections: [{ topics: [{
      prerequisite_strength: { a: 'hard' },
      children: [],
    }] }] }],
  }
  assert.doesNotThrow(() => normalizeOpenAIPrerequisiteStrength(null))
  assert.doesNotThrow(() => normalizeOpenAIPrerequisiteStrength({ branches: 'invalid' }))
  normalizeOpenAIPrerequisiteStrength(curriculum)
  assert.deepEqual(
    (curriculum.branches[0].sections[0].topics[0] as any).prerequisite_strength,
    { a: 'hard' },
  )
})
