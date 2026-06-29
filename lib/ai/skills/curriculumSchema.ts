import type {
  AIProviderName,
  AIResponseSchema,
} from '@/lib/ai/types'
import type { CurriculumMode } from '@/lib/ai/skills/types'

const COMMON_TOPIC_PROPERTIES = {
  id: { type: 'string' },
  title: { type: 'string' },
  description: { type: 'string' },
  prerequisites: { type: 'array', items: { type: 'string' } },
  prerequisite_strength: {
    type: 'object',
    additionalProperties: { type: 'string', enum: ['hard', 'soft'] },
  },
  depth: { type: 'string', enum: ['light', 'medium', 'important', 'critical'] },
  estimated_pages: { type: 'integer' },
  node_type: {
    type: 'string',
    enum: ['container', 'learning_unit', 'bridge', 'example_unit', 'assessment_unit'],
  },
  importance: { type: 'string', enum: ['core', 'supporting'] },
  role: { type: 'string', enum: ['foundation', 'mechanism', 'application', 'tool', 'theory'] },
  spine_candidate: { type: 'boolean' },
  spine_level: { type: 'integer' },
}

const COMMON_TOPIC_REQUIRED = Object.keys(COMMON_TOPIC_PROPERTIES)

function topicDefinition(mode: CurriculumMode) {
  const sourceProperties = mode === 'source_grounded'
    ? {
        source_refs: { type: 'array', minItems: 1, items: { type: 'string' } },
        concept_group: { type: 'string', enum: ['prequel', 'current', 'sequel'] },
      }
    : {}

  return {
    type: 'object',
    properties: {
      ...COMMON_TOPIC_PROPERTIES,
      ...sourceProperties,
      children: { type: 'array', items: { '$ref': '#/$defs/topic_node' } },
    },
    required: [
      ...COMMON_TOPIC_REQUIRED,
      ...Object.keys(sourceProperties),
      'children',
    ],
  }
}

function curriculumSchemaBody(mode: CurriculumMode) {
  const sourceProperties = mode === 'source_grounded'
    ? {
        source_sequence_policy: {
          type: 'string',
          enum: ['preserve_uploaded_source_order', 'conceptual_reorder_allowed'],
        },
      }
    : {}

  return {
    type: 'object',
    '$defs': {
      topic_node: topicDefinition(mode),
    },
    properties: {
      title: { type: 'string' },
      complexity: { type: 'string', enum: ['narrow', 'standard', 'deep', 'expert'] },
      structure_reasoning: { type: 'string' },
      ...sourceProperties,
      branches: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string' },
            sections: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  topics: {
                    type: 'array',
                    minItems: 1,
                    items: { '$ref': '#/$defs/topic_node' },
                  },
                },
                required: ['title', 'topics'],
              },
            },
          },
          required: ['id', 'title', 'description', 'sections'],
        },
      },
    },
    required: [
      'title',
      'complexity',
      'structure_reasoning',
      ...Object.keys(sourceProperties),
      'branches',
    ],
  }
}

export const AI_TEACHER_CURRICULUM_RESPONSE_SCHEMA: AIResponseSchema = {
  name: 'trulurn_ai_teacher_curriculum_v2',
  schema: curriculumSchemaBody('ai_teacher'),
}

export const SOURCE_CURRICULUM_RESPONSE_SCHEMA: AIResponseSchema = {
  name: 'trulurn_source_curriculum_v2',
  schema: curriculumSchemaBody('source_grounded'),
}

/** Backward-compatible alias for callers that only need the generic schema export. */
export const CURRICULUM_RESPONSE_SCHEMA = AI_TEACHER_CURRICULUM_RESPONSE_SCHEMA

type JSONSchemaNode = Record<string, unknown>

function isObjectSchema(node: JSONSchemaNode): boolean {
  const type = node.type
  return type === 'object' || (Array.isArray(type) && type.includes('object'))
}

function isDictionaryNode(node: JSONSchemaNode): boolean {
  return (
    isObjectSchema(node)
    && !node.properties
    && Boolean(node.additionalProperties)
    && typeof node.additionalProperties === 'object'
  )
}

function dictionaryNodeToPairsArray(node: JSONSchemaNode, keyName: string, valueName: string) {
  return {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        [keyName]: { type: 'string' },
        [valueName]: node.additionalProperties,
      },
      required: [keyName, valueName],
      additionalProperties: false,
    },
  }
}

function hardenDefs(defs: JSONSchemaNode) {
  return Object.fromEntries(Object.entries(defs).map(([name, def]) => [name, toStrictNode(def)]))
}

function toStrictNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toStrictNode)
  if (!node || typeof node !== 'object') return node

  const record = node as JSONSchemaNode
  const result: JSONSchemaNode = {}
  for (const [key, value] of Object.entries(record)) {
    result[key] = key === '$defs' ? hardenDefs(value as JSONSchemaNode) : toStrictNode(value)
  }

  if (isObjectSchema(record) && record.properties) {
    const properties = result.properties as JSONSchemaNode
    result.properties = Object.fromEntries(
      Object.entries(properties).map(([propName, propSchema]) => [
        propName,
        isDictionaryNode(propSchema as JSONSchemaNode)
          ? dictionaryNodeToPairsArray(propSchema as JSONSchemaNode, 'topic_id', 'strength')
          : propSchema,
      ]),
    )
    result.additionalProperties = false
    result.required = Object.keys(result.properties as JSONSchemaNode)
  }

  return result
}

function schemaForMode(mode: CurriculumMode) {
  return mode === 'source_grounded'
    ? SOURCE_CURRICULUM_RESPONSE_SCHEMA
    : AI_TEACHER_CURRICULUM_RESPONSE_SCHEMA
}

export function toGeminiCurriculumResponseSchema(
  mode: CurriculumMode = 'ai_teacher',
): AIResponseSchema {
  return schemaForMode(mode)
}

export function toOpenAICurriculumResponseSchema(
  mode: CurriculumMode = 'ai_teacher',
): AIResponseSchema & { strict: true } {
  const canonical = schemaForMode(mode)
  return {
    name: canonical.name,
    schema: toStrictNode(canonical.schema) as Record<string, unknown>,
    strict: true,
  }
}

export function curriculumResponseSchemaForProvider(
  provider: AIProviderName,
  mode: CurriculumMode = 'ai_teacher',
): AIResponseSchema | undefined {
  // Gemini omitted here on purpose: a live spike confirmed responseJsonSchema's
  // recursive $ref support silently flattens nested topic_node children into
  // siblings (identical prompt without the schema nested correctly; with the
  // schema, every child came back at depth 0). Until that's fixed upstream,
  // Gemini gets no enforced schema and relies on the prompt's prose contract
  // plus the existing validator/repair pipeline. OpenAI's strict mode is a
  // different implementation and wasn't shown to have this bug.
  return provider === 'openai' ? toOpenAICurriculumResponseSchema(mode) : undefined
}

export function curriculumResponseSchemaResolver(mode: CurriculumMode) {
  return (provider: AIProviderName) => curriculumResponseSchemaForProvider(provider, mode)
}

// OpenAI strict schemas represent arbitrary-key maps as key/value arrays.
// Normalize that provider-specific representation immediately after parsing.
export function normalizeOpenAIPrerequisiteStrength(curriculum: unknown): void {
  function visitTopic(topic: unknown) {
    if (!topic || typeof topic !== 'object') return
    const record = topic as Record<string, unknown>
    if (Array.isArray(record.prerequisite_strength)) {
      const map: Record<string, string> = {}
      for (const pair of record.prerequisite_strength) {
        if (!pair || typeof pair !== 'object') continue
        const { topic_id, strength } = pair as Record<string, unknown>
        if (
          typeof topic_id === 'string'
          && (strength === 'hard' || strength === 'soft')
        ) {
          map[topic_id] = strength
        }
      }
      record.prerequisite_strength = map
    }
    if (Array.isArray(record.children)) record.children.forEach(visitTopic)
  }

  if (!curriculum || typeof curriculum !== 'object') return
  const branches = (curriculum as Record<string, unknown>).branches
  if (!Array.isArray(branches)) return
  for (const branch of branches) {
    const sections = (branch as Record<string, unknown>)?.sections
    if (!Array.isArray(sections)) continue
    for (const section of sections) {
      const topics = (section as Record<string, unknown>)?.topics
      if (Array.isArray(topics)) topics.forEach(visitTopic)
    }
  }
}
