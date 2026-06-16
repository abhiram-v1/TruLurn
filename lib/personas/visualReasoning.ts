import type { PersonaSurface } from './types'

const SHARED = `VISUAL REASONING:
- Decide whether a chart would make the relationship easier to understand than prose, math, code, or a table.
- Use charts for meaningful quantitative shape: trends, distributions, comparisons, correlations, tradeoffs, growth rates, and changing quantities.
- Do not add decorative charts. A visual must carry explanatory, diagnostic, assessment, or recall work.
- Explain what the learner should notice and why it matters; never drop in a chart without interpretation.
- Never invent measured data. Clearly label pedagogical values as illustrative.
- Apply subject-specific visual rules only when supplied by the active course skill context.`

const SURFACE_RULES: Record<PersonaSurface, string> = {
  lesson: 'Use a chart when the learning architecture requests one or when quantitative shape is essential to the assigned understanding.',
  agent: 'Generate a chart when the learner asks to visualize something or when a visual would materially resolve the question or confusion.',
  quiz: 'Use a chart only when interpreting visual evidence is itself part of the skill being tested. Do not let it reveal the answer.',
  recall: 'Use a chart only when reconstructing or interpreting a recently learned quantitative relationship is the memory target.',
}

export function buildPersonaVisualReasoningDirective(surface: PersonaSurface) {
  return `${SHARED}
${SURFACE_RULES[surface]}`
}
