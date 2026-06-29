import type { PersonaSurface } from './types'

const SURFACE_RULES: Record<PersonaSurface, string> = {
  lesson: 'Use one when quantitative shape is essential or the learning architecture requests it.',
  agent: 'Use one when requested or when it materially resolves the learner’s question.',
  quiz: 'Use one only when interpreting visual evidence is the tested skill; never reveal the answer.',
  recall: 'Use one only when reconstructing a learned quantitative relationship is the memory target.',
}

export function buildPersonaVisualReasoningDirective(surface: PersonaSurface) {
  return `VISUAL REASONING:
- Prefer prose, math, code, or a table unless a chart materially clarifies a trend, distribution, comparison, correlation, tradeoff, or changing quantity.
- Every visual must do teaching work. Explain what to inspect and why it matters; label invented pedagogical values as illustrative.
- Follow the active course skill context and its visual rules when supplied.
${SURFACE_RULES[surface]}`
}
