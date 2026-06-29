import type { AIResponseSchema } from '@/lib/ai/types'
import type { CurriculumMode } from '@/lib/ai/skills/types'
import type { CurriculumGraphBranch, CurriculumGraphTopic } from './curriculum.ts'
import type { GraphGenerationIssue, GraphSourceEvidencePacket } from './types.ts'

// Graph generation runs as a sequence of small continuation steps rather than one
// large call: each branch's nodes are mapped in its own request (carrying the
// nodes already mapped in earlier branches as context), and a final request adds
// the dependency edges across the whole node set. Splitting the work keeps every
// individual response small enough for a fast model to finish well inside the
// request timeout, and lets a failed step retry without discarding good work.

// The per-topic shape the node stage emits. It deliberately omits `state`:
// learner/active state is a course-global decision (exactly one active topic
// across all branches) that the orchestrator sets after assembly, so no single
// per-branch call can own it.
const GRAPH_TOPIC_NODE_PROPERTIES = {
  id: { type: 'string' },
  branch_id: { type: 'string' },
  section: { type: 'string' },
  title: { type: 'string' },
  position: { type: 'integer' },
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
}

export const GRAPH_NODE_RESPONSE_SCHEMA: AIResponseSchema = {
  name: 'trulurn_graph_nodes_v2',
  schema: {
    type: 'object',
    required: ['topics'],
    properties: {
      topics: {
        type: 'array',
        items: {
          type: 'object',
          required: Object.keys(GRAPH_TOPIC_NODE_PROPERTIES),
          properties: GRAPH_TOPIC_NODE_PROPERTIES,
        },
      },
    },
  },
}

export const GRAPH_EDGE_RESPONSE_SCHEMA: AIResponseSchema = {
  name: 'trulurn_graph_edges_v2',
  schema: {
    type: 'object',
    required: ['structural_edges'],
    properties: {
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

export const GRAPH_SYSTEM_CONTRACT = `You are TruLurn's graph generation engine.
You are a curriculum mapper, never a curriculum creator. The approved curriculum is the complete node boundary.
Return only JSON matching the supplied schema.

Hard rules:
- Never invent, omit, rename, merge, or split curriculum nodes.
- Node and branch IDs must be copied character-for-character.
- A prerequisite means the target genuinely cannot be understood without the source node. Sequence alone is not a prerequisite.
- Prefer minimal graph complexity. Do not add relationships for visual density.
- Graph generation runs as a sequence of steps; stay consistent with the nodes and decisions from earlier steps.
- Generated structure is a recommendation, not mastery truth. Learner progress and active state are assigned later.`

function formatEvidence(packets: GraphSourceEvidencePacket[]) {
  return packets.length
    ? JSON.stringify(packets)
    : 'No source evidence packets are attached because this is an AI-generated curriculum.'
}

function correctionBlock(label: string, issues?: GraphGenerationIssue[]) {
  if (!issues?.length) return ''
  return `\n\nThe previous ${label} attempt failed deterministic validation:
${issues.slice(0, 30).map((issue) =>
    `- ${issue.code}${issue.path ? ` at ${issue.path}` : ''}: ${issue.message}`).join('\n')}
Repair only these violations and keep every correct value unchanged.`
}

export function buildGraphNodeStagePrompt(input: {
  mode: CurriculumMode
  branch: CurriculumGraphBranch
  branchTopics: CurriculumGraphTopic[]
  priorNodes: Array<{ id: string; title: string; branch_id: string }>
  sourcePackets?: GraphSourceEvidencePacket[]
  correctionIssues?: GraphGenerationIssue[]
}): { system: string; user: string; responseSchema: AIResponseSchema } {
  const sourceMode = input.mode === 'source_grounded'
  const branchPackets = (input.sourcePackets ?? []).filter((packet) =>
    packet.topic_evidence.some((evidence) =>
      input.branchTopics.some((topic) => topic.id === evidence.topic_id)))

  return {
    system: GRAPH_SYSTEM_CONTRACT,
    user: `Mode: ${input.mode}
Step: map ONE branch of the course into graph nodes. Later steps map the other branches and the dependency edges.

Branch to map: [${input.branch.id}] ${input.branch.title}
${input.branch.description ? `Branch description: ${input.branch.description}` : ''}

Approved curriculum nodes for THIS branch (map every one exactly once, no more, no fewer):
${JSON.stringify(input.branchTopics)}

Nodes already mapped in earlier branches (context for cross-branch prerequisites; do NOT re-emit them):
${input.priorNodes.length ? JSON.stringify(input.priorNodes) : 'None yet — this is the first branch.'}

${sourceMode
  ? `Source evidence for this branch:
${formatEvidence(branchPackets)}
SOURCE-GROUNDED NODE RULES:
- Every emitted topic must include at least one source_refs entry matching an attached packet source_id.
- Copy source_refs from the approved node; never invent evidence IDs.`
  : `AI-GENERATED NODE RULES:
- Follow the approved syllabus and learning objectives; do not widen scope.
- Put foundations first and keep parallel ideas parallel.`}

For every approved node in this branch, emit one graph topic with:
- hierarchy: parent_id (within THIS branch only, or null), path_ids and path_titles consistent with that parent chain, depth_level, children_count, is_leaf.
- placement: section, position.
- learning metadata copied from the approved node: title, depth, importance, role, estimated_pages, node_type, source_refs.
- sequencing: sequence_index ordering this branch's topics.
- relationships: prerequisites (may reference earlier-branch node IDs), prerequisite_strength, recommended_next_ids.
Do not set learner or active state. Output only this branch's "topics" array now.${correctionBlock('node', input.correctionIssues)}`,
    responseSchema: GRAPH_NODE_RESPONSE_SCHEMA,
  }
}

export function buildGraphEdgeStagePrompt(input: {
  mode: CurriculumMode
  nodes: Array<Record<string, unknown>>
  sourcePackets?: GraphSourceEvidencePacket[]
  correctionIssues?: GraphGenerationIssue[]
}): { system: string; user: string; responseSchema: AIResponseSchema } {
  const sourceMode = input.mode === 'source_grounded'
  const compactNodes = input.nodes.map((node) => ({
    id: node.id,
    title: node.title,
    branch_id: node.branch_id,
    node_type: node.node_type,
    parent_id: node.parent_id ?? null,
    prerequisites: Array.isArray(node.prerequisites) ? node.prerequisites : [],
    source_refs: Array.isArray(node.source_refs) ? node.source_refs : [],
  }))

  return {
    system: GRAPH_SYSTEM_CONTRACT,
    user: `Mode: ${input.mode}
Final step: connect the already-mapped nodes with dependency edges. The nodes are fixed — do not add, remove, or rename any node.

All mapped graph nodes:
${JSON.stringify(compactNodes)}

Source evidence packets:
${formatEvidence(input.sourcePackets ?? [])}

Produce a "structural_edges" array only:
- hierarchy edges for each parent → child relationship already present in the nodes.
- prerequisite edges where a node genuinely requires another (no cycles).
- recommended edges for a helpful study order.
- semantic edges only when two nodes are genuinely related; use sparingly.
Every edge's from_topic_id and to_topic_id must be IDs present in the nodes above; a node cannot connect to itself.

${sourceMode
  ? `SOURCE-GROUNDED EDGE RULES:
- Each edge needs source_refs, or a reason that explicitly identifies it as a curriculum hierarchy or study-order recommendation.
- Use only source_id values present in the evidence packets.`
  : `AI-GENERATED EDGE RULES:
- Keep parallel paths parallel unless a true prerequisite connects them.
- source_refs may be empty for AI-generated courses.`}
Output the structural_edges array now.${correctionBlock('edge', input.correctionIssues)}`,
    responseSchema: GRAPH_EDGE_RESPONSE_SCHEMA,
  }
}
