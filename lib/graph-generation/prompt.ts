import type { AIResponseSchema } from '@/lib/ai/types'
import { flattenCurriculumForGraph } from './curriculum.ts'
import type { GraphGenerationInput, GraphSourceEvidencePacket } from './types.ts'

export const GRAPH_GENERATION_RESPONSE_SCHEMA: AIResponseSchema = {
  name: 'trulurn_graph_generation_v2',
  schema: {
    type: 'object',
    required: ['branches', 'topics', 'structural_edges'],
    properties: {
      branches: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'title', 'state', 'active_topic_id', 'topic_count', 'mastered_count'],
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            state: { type: 'string', enum: ['not_started', 'in_progress', 'mastered'] },
            active_topic_id: { type: ['string', 'null'] },
            topic_count: { type: 'integer' },
            mastered_count: { type: 'integer' },
          },
        },
      },
      topics: {
        type: 'array',
        items: {
          type: 'object',
          required: [
            'id', 'branch_id', 'section', 'title', 'position', 'state', 'parent_id',
            'path_ids', 'path_titles', 'depth_level', 'node_type', 'is_leaf',
            'children_count', 'learning_depth', 'sequence_index', 'recommended_next_ids',
            'importance', 'role', 'spine_candidate', 'spine_level',
            'prerequisite_strength', 'is_optional', 'covered_by_node_id',
            'prerequisites', 'depth', 'estimated_pages', 'source_refs',
          ],
          properties: {
            id: { type: 'string' },
            branch_id: { type: 'string' },
            section: { type: 'string' },
            title: { type: 'string' },
            position: { type: 'integer' },
            state: { type: 'string', enum: ['locked', 'active'] },
            parent_id: { type: ['string', 'null'] },
            path_ids: { type: 'array', items: { type: 'string' } },
            path_titles: { type: 'array', items: { type: 'string' } },
            depth_level: { type: 'integer' },
            node_type: {
              type: 'string',
              enum: ['container', 'learning_unit', 'bridge', 'example_unit', 'assessment_unit'],
            },
            is_leaf: { type: 'boolean' },
            children_count: { type: 'integer' },
            learning_depth: { type: 'string', enum: ['overview', 'standard', 'deep'] },
            sequence_index: { type: 'integer' },
            recommended_next_ids: { type: 'array', items: { type: 'string' } },
            importance: { type: 'string', enum: ['core', 'supporting'] },
            role: { type: 'string', enum: ['foundation', 'mechanism', 'application', 'tool', 'theory'] },
            spine_candidate: { type: 'boolean' },
            spine_level: { type: 'integer' },
            prerequisite_strength: {
              type: 'object',
              additionalProperties: { type: 'string', enum: ['hard', 'soft'] },
            },
            is_optional: { type: 'boolean' },
            covered_by_node_id: { type: ['string', 'null'] },
            prerequisites: { type: 'array', items: { type: 'string' } },
            depth: { type: 'string', enum: ['light', 'medium', 'important', 'critical'] },
            estimated_pages: { type: 'integer' },
            source_refs: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      structural_edges: {
        type: 'array',
        items: {
          type: 'object',
          required: ['from_topic_id', 'to_topic_id', 'edge_type', 'reason', 'source_refs'],
          properties: {
            from_topic_id: { type: 'string' },
            to_topic_id: { type: 'string' },
            edge_type: {
              type: 'string',
              enum: ['hierarchy', 'prerequisite', 'recommended', 'semantic'],
            },
            reason: { type: 'string' },
            source_refs: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  },
}

function formatEvidence(packets: GraphSourceEvidencePacket[]) {
  return packets.length
    ? JSON.stringify(packets)
    : 'No source evidence packets are attached because this is an AI-generated curriculum.'
}

export function buildGraphGenerationPrompt(input: GraphGenerationInput) {
  const curriculum = flattenCurriculumForGraph(input.curriculum)
  const sourcePackets = input.sourceEvidencePackets ?? []
  const sourceMode = input.mode === 'source_grounded'

  return {
    system: `You are TruLurn's graph generation engine.
You are a curriculum mapper, never a curriculum creator. The approved curriculum is the complete node boundary.
Return only JSON matching the supplied schema.

Internally perform these five stages before output:
1. CONCEPT EXTRACTION: read every approved curriculum node and its learning objective.
2. NODE SELECTION: preserve every approved node exactly once; decide only its structural role and placement.
3. DEPENDENCY ANALYSIS: infer true prerequisites, parent-child relationships, parallel paths, and useful recommendations.
4. GRAPH OPTIMIZATION: reduce redundancy and complexity while preserving curriculum scope and understandable learning flow.
5. GRAPH OUTPUT: emit branches, topics, structural edges, dependency metadata, hierarchy, and evidence references.

Hard rules:
- Never invent, omit, rename, merge, or split curriculum nodes.
- Node and branch IDs must be copied character-for-character.
- You may improve parent-child grouping within the same branch when it reduces redundancy or clarifies learning flow. Keep path_ids and path_titles consistent with the resulting hierarchy.
- A prerequisite means the target cannot be understood without the source node. Sequence alone is not a prerequisite.
- Prefer minimal graph complexity. Do not add semantic edges for visual density.
- Exactly one teachable leaf starts active. Generated structure is a recommendation, not mastery truth.
- User edits and learner state are outside this generation task.`,
    user: `Mode: ${input.mode}
Approved curriculum graph input:
${JSON.stringify(curriculum)}

Source evidence packets:
${formatEvidence(sourcePackets)}

${sourceMode
  ? `SOURCE-GROUNDED CONTRACT:
- 100% of graph nodes must remain backed by the approved source-grounded curriculum.
- Every topic must include at least one source_refs entry matching an attached packet source_id.
- Every edge needs source_refs or a reason explicitly identifying it as a curriculum hierarchy/study recommendation.
- Preserve uploaded source order as the primary spine when source_sequence_policy requests it.
- Reordering is allowed only for a true prerequisite and the reason must identify the evidence-backed dependency.
- Structural optimization may merge duplicate relationships and improve hierarchy, but may not expand scope.`
  : `AI-GENERATED CONTRACT:
- Follow the approved syllabus and learning objectives.
- Put foundations first, support progressive skill building, and avoid unnecessary node proliferation.
- Keep parallel paths parallel unless a true prerequisite connects them.`}

Copy curriculum metadata such as title, section, depth, importance, role, page estimate, and source anchor into the corresponding graph topic. Output the graph now.`,
    responseSchema: GRAPH_GENERATION_RESPONSE_SCHEMA,
  }
}

export function buildGraphRepairPrompt(input: {
  original: ReturnType<typeof buildGraphGenerationPrompt>
  previousOutput: string
  issues: Array<{ code: string; message: string; path?: string }>
}) {
  return {
    system: input.original.system,
    user: `${input.original.user}

The previous candidate failed deterministic validation:
${input.issues.slice(0, 30).map((issue) =>
    `- ${issue.code}${issue.path ? ` at ${issue.path}` : ''}: ${issue.message}`).join('\n')}

Previous candidate:
${input.previousOutput.slice(0, 45_000)}

Repair only these violations. Preserve every correct curriculum ID and return a complete replacement graph.`,
    responseSchema: GRAPH_GENERATION_RESPONSE_SCHEMA,
  }
}
