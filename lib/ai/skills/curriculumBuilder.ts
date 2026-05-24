import type { CurriculumSkillInput, SkillPrompt } from '@/lib/ai/skills/types'

export function curriculumBuilderSkill(input: CurriculumSkillInput): SkillPrompt {
  const sourceRule =
    input.mode === 'source_grounded'
      ? 'Use only the supplied source text. If the source does not contain enough information, say what is missing in the JSON.'
      : 'Use general model knowledge. Be accurate and do not over-promise.'

  return {
    name: 'curriculum_builder',
    system: `You are TruLurn's curriculum builder.
You produce a structured learning plan for a mastery system.
You judge only demonstrated evidence, never the learner's mind.
Return only valid JSON. No markdown. No prose outside JSON.`,
    user: `Build a curriculum.

Mode: ${input.mode}
Topic: ${input.topic}
Goals: ${input.goals}

Rule:
${sourceRule}

Source text, if any:
---
${input.sourceText ?? 'No source text supplied.'}
---

Return this exact JSON shape:
{
  "title": "course title",
  "complexity": "narrow|standard|deep|expert",
  "structure_reasoning": "why this roadmap size and depth fits the goal",
  "branches": [
    {
      "id": "slug",
      "title": "top-level branch",
      "description": "short description",
      "state": "not_started",
      "sections": [
        {
          "title": "section title",
          "topics": [
            {
              "id": "slug",
              "title": "topic title",
              "description": "what this topic teaches",
              "prerequisites": ["topic id"],
              "depth": "light|medium|important|critical",
              "estimated_pages": 4,
              "initial_state": "locked"
            }
          ]
        }
      ]
    }
  ],
  "source_limitations": []
}

Rules:
- Determine the number of branches, sections, and topics from the subject difficulty, target depth, and source volume.
- Use enough topics to avoid shallow coverage, but do not split tiny ideas into artificial fragments.
- A narrow practical topic may have fewer branches. A deep academic or technical topic needs more breadth and depth.
- First topic in the first branch must be unlocked as active.
- Prerequisites must reference topic ids that appear earlier.
- Every topic needs a depth and estimated_pages. Use light=1-2, medium=2-3, important=3-5, critical=5-8.
- Do not include user mastery or progress claims. This is the fixed subject roadmap only.`,
  }
}
