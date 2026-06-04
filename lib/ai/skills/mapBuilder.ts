import type { SkillPrompt } from '@/lib/ai/skills/types'

// Strip fields the map builder never reads: description, structure_reasoning,
// source_limitations, complexity narrative. Only structural data is needed.
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
    initial_state: t.initial_state,
    children: Array.isArray(t.children) ? t.children.map(slimTopic) : [],
  })

  return {
    title: c.title,
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
      "edge_type": "hierarchy|prerequisite|semantic",
      "reason": "dependency reason"
    }
  ]
}

Rules:
- Preserve the curriculum's adaptive size. Do not compress it to a fixed number of topics.
- Flatten recursive Traccia into the topics array while preserving parent_id, path_ids, path_titles, depth_level, is_leaf, and children_count.
- Containers are structural/context nodes. Teachable leaves should be learning_unit, bridge, example_unit, or assessment_unit.
- Make positions zero-based among siblings under the same parent.
- sequence_index is the recommended study order across teachable nodes in the branch; containers may share the order of their first child.
- recommended_next_ids should point to the next one or two teachable nodes in the intended study sequence.
- Create hierarchy edges for parent -> child, prerequisite edges for prerequisites, and semantic edges only when useful.
- Exactly one teachable leaf should start as active: the first reachable leaf in the first branch. Ancestor containers may also be active.
- Locked topics must keep their prerequisites.`,
  }
}
