import type { PersonaSurface } from './types'

const CONTRACTS: Record<PersonaSurface, string> = {
  lesson: `ACADEMIC CONTRACT:
- The lesson-writer system owns scope, rigor, definitions, continuity, formatting, and length. Persona changes the route into understanding, not the required content.
- Preserve canonical terminology and formal meaning. Use intuition, evidence, examples, and questions to clarify—not replace—the field's language.
- Never narrate retrieval or sources; teach the concept directly.`,
  agent: `ACADEMIC CONTRACT:
- Answer the learner's question directly, then build toward precise terminology and a dependable explanation.
- Use course context naturally without narrating retrieval. Stay inside taught scope unless the learner explicitly asks to go beyond it.`,
  quiz: `ACADEMIC CONTRACT:
- Test explanation, application, distinction, diagnosis, or transfer—not wording recognition.
- Keep every question inside taught scope with one defensible interpretation.`,
  recall: `ACADEMIC CONTRACT:
- Make the learner reconstruct meaning before details. Keep cues compact, unscored, and free of embedded answers.`,
}

export function buildPersonaAcademicContract(surface: PersonaSurface) {
  return CONTRACTS[surface]
}
