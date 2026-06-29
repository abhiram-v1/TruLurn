import type { CurriculumSkillInput } from './types.ts'

export const CURRICULUM_PROMPT_VERSION = 'curriculum-v2'
export const LEGACY_CURRICULUM_PROMPT_VERSION = 'curriculum-legacy-v1'
export type CurriculumPromptVersion =
  | typeof CURRICULUM_PROMPT_VERSION
  | typeof LEGACY_CURRICULUM_PROMPT_VERSION

export const CURRICULUM_SYSTEM_PROMPT = `You build TruLurn curricula: structured learning roadmaps for a mastery system.
Return only JSON. Every sub-topic must be nested inside its parent topic's "children" array — never emitted as a sibling, a separate list, or a flattened entry at the same level.

Design a coherent hierarchy with high-level Atlas branches and recursive Traccia topics. Create children only when a sub-area is independently learnable, explainable, practicable, or assessable. Prefer cohesive topics over artificial fragmentation.

Prerequisites are knowledge dependencies, not outline order. Reference only earlier topic IDs. Keep parallel ideas parallel, allow fan-out from foundations and fan-in for integration topics, and avoid linked-list graphs.

Use containers for broad areas and learning_unit, bridge, example_unit, or assessment_unit for teachable nodes. Containers normally need 0-1 pages; leaf units receive proportional page estimates. Assign depth, importance, role, and spine metadata for their real conceptual function.

Use a concise course title, accurate terminology, and no learner-progress claims. Do not emit fields beyond this shape; fixed state, source anchors, coverage markers, and source boundaries are hydrated after generation.`

const DEPTH = {
  low: 'Low depth: cover the governing ideas efficiently; prefer broader topics and the low end of page ranges.',
  standard: 'Standard depth: balance core explanation, examples, application, and relevant context.',
  high: 'High depth: support mastery with meaningful nuance, formalism, limitations, and examples; never pad.',
} as const

const AI_LEVEL = {
  beginner: 'Beginner: assume no domain background, make required foundations explicit, use small conceptual steps, and place intuition before formalism.',
  intermediate: 'Intermediate: skip familiar basics, emphasize mechanisms, comparisons, applications, and the points where basic intuition fails.',
  expert: 'Expert: skip introductions and emphasize formal models, derivations, complexity, failure modes, limitations, and advanced connections.',
} as const

const SOURCE_LEVEL = {
  beginner: 'Beginner treatment: put source-taught foundations first and make the later lessons accessible, but do not add background the sources merely assume.',
  intermediate: 'Intermediate treatment: preserve the source vocabulary and expected level; deepen covered mechanisms without widening scope.',
  expert: 'Expert treatment: preserve source-backed formalism, derivations, limitations, and advanced detail; expertise changes treatment, not syllabus scope.',
} as const

const AI_PURPOSE = {
  explorer: 'Explorer: organize around big ideas, intuition, and meaningful connections rather than tooling.',
  practitioner: 'Practitioner: organize around usable capabilities, workflows, decisions, patterns, and applied integration.',
  researcher: 'Researcher: organize around definitions, assumptions, models, derivations, evidence, limitations, and open questions.',
} as const

const SOURCE_PURPOSE = {
  explorer: 'Explorer emphasis: foreground intuition and connections already present in the material.',
  practitioner: 'Practitioner emphasis: foreground source-backed applications, workflows, and decisions.',
  researcher: 'Researcher emphasis: foreground source-backed assumptions, derivations, limitations, and theoretical structure.',
} as const

const PROGRESSION = {
  guided: 'Guided progression: build a careful prerequisite path and separate fundamentals only when they unlock later understanding.',
  balanced: 'Balanced progression: provide a strong default sequence with selective flexibility and concise foundations.',
  open: 'Open progression: keep the roadmap flexible, compress basics, and use prerequisites as guidance rather than a forced chain.',
} as const

function learnerSettings(input: CurriculumSkillInput, sourceMode: boolean) {
  const level = input.knowledgeLevel ?? 'intermediate'
  const purpose = input.learningPurpose ?? 'practitioner'
  return [
    DEPTH[input.courseDepth],
    (sourceMode ? SOURCE_LEVEL : AI_LEVEL)[level],
    (sourceMode ? SOURCE_PURPOSE : AI_PURPOSE)[purpose],
    PROGRESSION[input.learningControl],
  ].join('\n')
}

export function buildSourceCurriculumPrompt(
  input: CurriculumSkillInput,
  context: {
    fidelityNote?: string
    sourceProfile?: string
    sourceEvidence?: string
  },
) {
  return `Build a source-grounded curriculum.

Learner goal:
${input.goals}

Learner settings:
${learnerSettings(input, true)}

Source contract:
- The supplied evidence is the complete syllabus boundary. Organize what it teaches; never complete the broader subject from general knowledge.
- Every topic must cite one or more exact section IDs such as "s1:3" in source_refs. Reuse the source's terminology and section names.
- Merge repeated concepts across sources. Use prerequisites to connect genuinely dependent ideas across files.
- Preserve uploaded source order unless the material itself establishes a prerequisite that requires reordering; explain any reorder in structure_reasoning.
- concept_group is prequel for source-taught foundations, current for the main body, and sequel for source-taught extensions.
- Assumed background and merely mentioned follow-ups are not topics. They are hydrated into out_of_scope from the source profile.
- Topic count follows conceptual structure, not document or heading count. A cohesive document is usually one rich topic; split only independently learnable subject areas.
- Page estimates must be proportional to the amount and importance of supporting evidence.
${context.fidelityNote ?? ''}

${context.sourceProfile ? `Source profile:\n${context.sourceProfile}\n` : ''}
${input.sourceOrderAnalysis ? `Ordering evidence:\n${input.sourceOrderAnalysis}\n` : ''}
Source evidence:
${context.sourceEvidence || 'No compact source evidence was available.'}`
}

export function buildAITeacherCurriculumPrompt(input: CurriculumSkillInput) {
  const research = input.curriculumResearchBrief?.trim()
    ? input.curriculumResearchBrief.trim()
    : 'No external curriculum research brief was supplied.'

  return `Build an AI-teacher curriculum.

Learner goal:
${input.goals}

Learner settings:
${learnerSettings(input, false)}

Curriculum contract:
- Determine scope and roadmap size from the learner goal, subject difficulty, and selected depth.
- Cover domain-defining concepts without generic prerequisite padding.
- Keep Atlas branches high-level and place useful detail in recursive Traccia topics.
- Include foundations only when later topics genuinely depend on them.
- Use examples, projects, comparisons, proofs, or advanced topics only when they fit the learner settings and improve the roadmap.
- Page estimates are ceilings: light=1-2, medium=2-3, important=3-5, critical=5-8.

Research calibration:
${research}`
}

const LEGACY_DETAIL = `Legacy compatibility rules:
- Build a complete roadmap rather than a topic list. Use enough hierarchy to make navigation clear, but avoid shallow fragments.
- Only leaf learning units receive substantial page counts. Containers organize independently learnable children.
- A prerequisite means the later topic is not reasonably understandable without it. Parallel siblings share foundations instead of chaining to each other.
- importance is core only for load-bearing concepts. role must describe whether the topic is a foundation, mechanism, application, tool, or theory.
- spine_candidate is true only when the concept later supports multiple branches or unlocks a later conceptual layer.
- Give foundations only the space they need; depth and page counts must reflect conceptual density rather than position in the course.`

export function buildLegacySourceCurriculumPrompt(
  input: CurriculumSkillInput,
  context: {
    fidelityNote?: string
    sourceProfile?: string
    sourceEvidence?: string
  },
) {
  return `${buildSourceCurriculumPrompt(input, context)}

${LEGACY_DETAIL}
- Treat every source section as evidence, not automatically as its own topic.
- source_refs must point to the exact sections that teach each topic. Missing background and follow-up mentions remain outside the roadmap.`
}

export function buildLegacyAITeacherCurriculumPrompt(input: CurriculumSkillInput) {
  return `${buildAITeacherCurriculumPrompt(input)}

${LEGACY_DETAIL}
- For beginners, include genuinely necessary foundations and motivation. For experts, avoid introductory padding.
- Match explorer, practitioner, or researcher emphasis without narrowing essential subject coverage.`
}
