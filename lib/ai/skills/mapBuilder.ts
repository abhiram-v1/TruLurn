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

GRAPH TOPOLOGY — this is the most important section. Read it carefully before assigning prerequisites and recommended_next_ids.

The graph rendered from this data must look like a knowledge network, not a linear chain.
A chain (A→B→C→D→E→F) means every topic depends only on the one before it. This is almost never accurate and produces a useless graph. Avoid it.

PREREQUISITE RULES — prerequisites must reflect genuine conceptual dependency:
- Only list a topic as a prerequisite if the student genuinely cannot understand this topic without it. Not just "it comes earlier."
- Most topics at the same conceptual level share the same prerequisites — they do NOT depend on each other.
- A foundational topic (e.g. "Variables", "Functions") will be a prerequisite for MANY later topics. This is correct and desirable — it creates a fan-out shape.
- An advanced topic that synthesises multiple threads will list several prerequisites. This creates a fan-in shape.
- Siblings in the same section usually share a common prerequisite but do NOT depend on each other. Do not chain them.
- If Topic A and Topic B are both required before Topic C, list both A and B as prerequisites of C.

RECOMMENDED_NEXT_IDS RULES:
- A foundational topic should point to ALL topics it directly enables — often 2-5 topics at once.
- Do not reduce a fan-out to one link just because of ordering. If "Variables" enables both "Conditionals" and "Functions", point to both.
- Avoid making recommended_next_ids a simple serial chain. That produces a linear linked list graph.
- Only use a single next pointer when the subject is genuinely linear (e.g. a strict proof sequence).

STRUCTURAL EDGE RULES:
- Use prerequisite edges for every prerequisite relationship (not just hierarchy).
- Use semantic edges to connect topics from different branches that share a concept or are commonly studied together.
- Semantic edges make the graph network-like even across branches. Include at least one semantic edge per branch pair when there is a genuine conceptual link.
- Avoid adding semantic edges just to add density. Each edge must have a real reason.

GRAPH SHAPE TARGETS — aim for one of these topologies depending on the subject:
- Hub-and-spoke: a few foundational nodes each fan out to a cluster of dependent topics. Common in most technical courses.
- Layered DAG: 3-5 conceptual layers where each layer has multiple parallel topics. Avoid having all layers contain only one topic.
- Converging tracks: two or more independent early tracks that merge at an integration topic. Common in courses combining theory and practice.
- Linear (acceptable only): genuinely sequential subjects where each concept strictly requires the previous — proofs, algorithms, language learning stages. If the subject is linear, produce a linear graph. Do not force artificial branching.

WHAT TO AVOID:
- A→B→C→D→E→F→G (pure chain) — almost always wrong unless the subject is genuinely sequential
- Every topic having exactly one prerequisite and one recommended_next — this means you created a linked list
- Topics in the same section all depending on each other — they should share a common prerequisite instead

Rules:
- Preserve the curriculum's adaptive size. Do not compress it to a fixed number of topics.
- Flatten recursive Traccia into the topics array while preserving parent_id, path_ids, path_titles, depth_level, is_leaf, and children_count.
- Containers are structural/context nodes. Teachable leaves should be learning_unit, bridge, example_unit, or assessment_unit.
- Make positions zero-based among siblings under the same parent.
- sequence_index is the recommended study order across teachable nodes in the branch; containers may share the order of their first child.
- Create hierarchy edges for parent -> child, prerequisite edges for all prerequisite relationships, and semantic edges for cross-branch conceptual links.
- Exactly one teachable LEAF should start as active: the first reachable leaf in the first branch. Do NOT set a container as the active node — containers cannot be opened directly.
- Locked topics must keep their prerequisites.

BRANCH ID CONSISTENCY — CRITICAL:
- Every topic's branch_id MUST exactly match the id field of the branch it belongs to.
- Copy the branch id string character-for-character into branch_id. Do NOT change dashes to underscores, do NOT change case, do NOT add prefixes.
- Example: if the branch is { "id": "python-basics" }, every topic in that branch must have "branch_id": "python-basics" — not "python_basics", not "Python-Basics", not anything else.
- Mismatched branch_id causes the Atlas navigation to break.`,
  }
}
