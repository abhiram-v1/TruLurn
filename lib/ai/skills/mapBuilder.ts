import type { SkillPrompt } from '@/lib/ai/skills/types'

export function mapBuilderSkill(courseJson: unknown): SkillPrompt {
  return {
    name: 'map_builder',
    system: `You are TruLurn's map builder.
You convert a curriculum into a fixed structural roadmap.
You do not infer user mastery. You only define subject structure.
Return only valid JSON.`,
    user: `Convert this curriculum into structural roadmap data:

${JSON.stringify(courseJson, null, 2)}

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
      "prerequisites": ["topic id"],
      "depth": "light|medium|important|critical",
      "estimated_pages": 3
    }
  ],
  "structural_edges": [
    {
      "from_topic_id": "topic id",
      "to_topic_id": "topic id",
      "reason": "dependency reason"
    }
  ]
}

Rules:
- Preserve the curriculum's adaptive size. Do not compress it to a fixed number of topics.
- Edges are structural subject dependencies only.
- Make positions zero-based within their branch unless the input clearly uses another stable order.
- Exactly one topic should start as active: the first reachable topic in the first branch.
- Locked topics must keep their prerequisites.`,
  }
}
