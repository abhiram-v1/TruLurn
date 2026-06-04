import type { CurriculumSkillInput, SkillPrompt } from '@/lib/ai/skills/types'

export function curriculumBuilderSkill(input: CurriculumSkillInput): SkillPrompt {
  const sourceRule =
    input.mode === 'source_grounded'
      ? 'Use only the supplied source text. If the source does not contain enough information, say what is missing in the JSON.'
      : 'Use general model knowledge. Be accurate and do not over-promise.'
  const depthRule = {
    low: `Course depth: Low.
- Optimize for overview-level understanding and fast completion.
- Focus on core concepts and key intuitions only. Skip advanced nuances, edge cases, and supplementary content.
- Use the LOWER end of estimated_pages for every topic:
    light = 1 page | medium = 1–2 pages | important = 2–3 pages | critical = 3–5 pages
- Prefer broader topics with fewer subtopics over fine-grained breakdowns.`,
    standard: `Course depth: Standard.
- Balanced coverage suitable for most learners.
- Include core explanations, practical examples, and relevant context.
- Use the middle of estimated_pages ranges:
    light = 1–2 pages | medium = 2–3 pages | important = 3–5 pages | critical = 5–7 pages`,
    high: `Course depth: High.
- Comprehensive mastery-level coverage.
- Include detailed reasoning, advanced nuances, and additional examples where they provide genuine value.
- Use the UPPER end of estimated_pages ranges:
    light = 2–3 pages | medium = 3–5 pages | important = 5–7 pages | critical = 7–9 pages
- Include subtopics for advanced nuances and worked examples only when they genuinely aid mastery — no padding.`,
  }[input.courseDepth]

  const controlRule = {
    guided: `Guidance mode: Guided.
- Build a careful evidence-gated path.
- Fundamentals may be split when genuinely necessary, but do not over-expand obvious basics.
- Unlocking should assume quizzes/tasks are required before moving on.`,
    balanced: `Guidance mode: Balanced.
- Build the default TruLurn experience: solid structure with selective flexibility.
- Keep introductory/basic topics concise unless they are true prerequisites for many later concepts.
- The agent may later skip or prune ungenerated pages when the learner gives credible evidence of prior understanding.`,
    open: `Guidance mode: Open.
- Build a flexible learner-directed path.
- Compress basic/foundational topics aggressively unless the goal explicitly asks for fundamentals.
- The learner may jump topics; use the Atlas and graph to track skipped prerequisites rather than blocking progress.`,
  }[input.learningControl]

  return {
    name: 'curriculum_builder',
    system: `You are TruLurn's curriculum builder.
You produce a structured learning plan for a mastery system.
You judge only demonstrated evidence, never the learner's mind.
Return only valid JSON. No markdown. No prose outside JSON.`,
    user: `Build a curriculum.

Mode: ${input.mode}
Progression: ${input.learningControl}
Depth: ${input.courseDepth}
What the learner wants to learn:
${input.goals}

Rule:
${sourceRule}

Course depth policy:
${depthRule}

Progression policy:
${controlRule}

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
              "node_type": "container|learning_unit|bridge|example_unit|assessment_unit",
              "children": [
                {
                  "id": "child-topic-slug",
                  "title": "child topic title",
                  "description": "specific learnable unit or sub-area",
                  "prerequisites": ["topic id"],
                  "depth": "light|medium|important|critical",
                  "estimated_pages": 2,
                  "node_type": "learning_unit",
                  "children": []
                }
              ],
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
- Do not automatically give many pages to early fundamentals. Give foundational topics only the page count they need for the selected progression policy.
- Build recursive Traccia inside each section when the domain naturally has substructure. Use containers for broad areas and leaf learning_unit/bridge/example_unit nodes for teachable units.
- Keep Atlas branches high-level. Put deeper hierarchy inside Traccia children, not more branches.
- Only leaf learning units should have meaningful estimated_pages. Containers should usually use estimated_pages=0 or 1.
- Stop recursion when a node is independently learnable, practicable, assessable, or explainable.
- First topic in the first branch must be unlocked as active.
- Prerequisites must reference topic ids that appear earlier in the same recursive traversal.
- Every topic needs a depth and estimated_pages. Use light=1-2, medium=2-3, important=3-5, critical=5-8.
- For Guided, critical prerequisites may use the high end of the range.
- For Balanced, prefer the middle/lower range unless the topic is conceptually dense.
- For Open, prefer 1-2 pages for basics and let later agent requests add depth on demand.
- Do not include user mastery or progress claims. This is the fixed subject roadmap only.`,
  }
}
