import type { SkillPrompt } from '@/lib/ai/skills/types'

// Strip fields the map builder never reads. Keep source_sequence_policy because
// source-grounded exam material should preserve uploaded order when appropriate.
function slimCurriculum(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const c = raw as any
  const slimTopic = (t: any): any => ({
    id: t.id,
    title: t.title,
    description: t.description,
    prerequisites: t.prerequisites ?? [],
    depth: t.depth,
    estimated_pages: t.estimated_pages,
    node_type: t.node_type,
    importance: t.importance,
    role: t.role,
    spine_candidate: Boolean(t.spine_candidate),
    spine_level: Number.isFinite(t.spine_level) ? Number(t.spine_level) : 0,
    prerequisite_strength: t.prerequisite_strength ?? {},
    initial_state: t.initial_state,
    children: Array.isArray(t.children) ? t.children.map(slimTopic) : [],
  })

  return {
    title: c.title,
    source_sequence_policy: c.source_sequence_policy,
    branches: Array.isArray(c.branches)
      ? c.branches.map((b: any) => ({
          id: b.id,
          title: b.title,
          sections: Array.isArray(b.sections)
            ? b.sections.map((s: any) => ({
                title: s.title,
                topics: Array.isArray(s.topics)
                  ? s.topics.map(slimTopic)
                  : [],
              }))
            : [],
        }))
      : [],
  }
}

export function mapBuilderSkill(courseJson: unknown): SkillPrompt {
  return {
    name: 'map_builder',
    system: `You are TruLurn's map builder.
You convert a curriculum into a fixed structural roadmap.
You do not infer user mastery. You only define subject structure.
Return only valid JSON.`,
    user: `Convert this curriculum into structural roadmap data:

${JSON.stringify(slimCurriculum(courseJson))}

Return:
{
  "branches": [
    {
      "id": "branch id",
      "title": "branch title",
      "state": "not_started|in_progress|mastered",
      "active_topic_id": "topic id",
      "topic_count": 0,
      "mastered_count": 0
    }
  ],
  "topics": [
    {
      "id": "topic id",
      "branch_id": "branch id",
      "section": "section title",
      "title": "topic title",
      "position": 0,
      "state": "locked|active",
      "parent_id": "parent topic id or null",
      "path_ids": ["ancestor id", "topic id"],
      "path_titles": ["Ancestor", "Topic"],
      "depth_level": 0,
      "node_type": "container|learning_unit|bridge|example_unit|assessment_unit",
      "is_leaf": true,
      "children_count": 0,
      "learning_depth": "overview|standard|deep",
      "sequence_index": 0,
      "recommended_next_ids": ["next topic id"],
      "importance": "core|supporting",
      "role": "foundation|mechanism|application|tool|theory",
      "spine_candidate": false,
      "spine_level": 0,
      "prerequisite_strength": { "prerequisite topic id": "hard|soft" },
      "is_optional": false,
      "covered_by_node_id": null,
      "prerequisites": ["topic id"],
      "depth": "light|medium|important|critical",
      "estimated_pages": 3
    }
  ],
  "structural_edges": [
    {
      "from_topic_id": "topic id",
      "to_topic_id": "topic id",
      "edge_type": "hierarchy|prerequisite|recommended|semantic",
      "reason": "dependency reason"
    }
  ]
}

GRAPH TOPOLOGY
- Truth beats visual complexity. Use a network only when the subject really has parallel prerequisites, fan-in, fan-out, or useful semantic links.
- If source_sequence_policy is "preserve_uploaded_source_order", preserve the source/study order as the primary spine.
- For source-grounded semester or exam material, the uploaded order is a strong signal. A mostly linear sequence is acceptable when it matches the documents.
- For small curricula with fewer than 6 teachable topics, do not force fan-out or semantic links. Use the minimum edges needed to represent true sequence and dependency.
- For broad technical courses, avoid fake linked lists. Use hub-and-spoke, layered DAG, or converging tracks when those structures are genuinely present.

PREREQUISITE RULES
- A prerequisite means the student genuinely cannot understand this topic without the prerequisite. It does not merely mean "this came earlier".
- Sibling topics usually share a common prerequisite; they do not automatically depend on each other.
- Foundational topics can enable multiple later topics. This creates useful fan-out when it is real.
- Integration topics can require several earlier threads. This creates useful fan-in when it is real.
- If uploaded sources are ordered Hashing, Indexing, Transactions, preserve that order unless the text explicitly states another prerequisite relationship.

RECOMMENDED_NEXT_IDS RULES
- Use recommended_next_ids as a study-sequence recommendation, not as proof of mastery or strict locking.
- For source-grounded exam material, a single next pointer is valid when it follows the uploaded/source order.
- For genuinely parallel topics, a foundational node may point to multiple directly enabled topics.
- Do not create a single chain for broad courses just because arrays need an order.

STRUCTURAL EDGE RULES
- Use hierarchy edges for parent -> child.
- Use prerequisite edges only for true conceptual prerequisites.
- Use recommended edges for useful next-study choices that are not hard prerequisites.
- Use semantic edges only when the relationship would help learning, retrieval, or review.
- Small source-grounded courses may have zero semantic edges.
- Do not add semantic edges merely to make the graph look dense.

Rules:
- Preserve the curriculum's adaptive size. Do not compress it to a fixed number of topics.
- Flatten recursive Traccia into the topics array while preserving parent_id, path_ids, path_titles, depth_level, is_leaf, and children_count.
- Preserve importance, role, spine_candidate, spine_level, and prerequisite_strength from the curriculum. Do not silently replace them.
- Containers are structural/context nodes. Teachable leaves should be learning_unit, bridge, example_unit, or assessment_unit.
- Make positions zero-based among siblings under the same parent.
- sequence_index is the recommended study order across teachable nodes in the branch; containers may share the order of their first child.
- Exactly one teachable LEAF should start as active: the first reachable leaf in the first branch. Do not set a container as the active node.
- Locked topics must keep their prerequisites.

BRANCH ID CONSISTENCY - CRITICAL:
- Every topic's branch_id MUST exactly match the id field of the branch it belongs to.
- Copy the branch id string character-for-character into branch_id. Do not change dashes to underscores, do not change case, do not add prefixes.
- Example: if the branch is { "id": "python-basics" }, every topic in that branch must have "branch_id": "python-basics".
- Mismatched branch_id causes the Atlas navigation to break.`,
  }
}
