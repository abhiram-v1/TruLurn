import type { PersonaLessonContext } from './types'

export function buildTextbookContinuityDirective(context?: PersonaLessonContext) {
  if (!context) return ''

  const opening = context.continuesFromPrevious
    ? 'Write as a direct continuation of the preceding reasoning: no fresh hook, reintroduction, or recap.'
    : 'Begin only what this planned manuscript span genuinely starts.'
  const closing = context.continuesToNext
    ? 'Do not conclude the topic. Stop at the planned natural pause without a recap, takeaway, or forced challenge.'
    : 'Close the overall explanation naturally after the assigned material is complete.'
  const budget = context.targetWords
    ? `Treat ${context.targetWords} words as an upper budget; use up to ${context.softMaxWords ?? context.targetWords} words only to finish a nearly complete concept or worked step.`
    : ''

  return `TEXTBOOK CONTINUITY:
- This is one physical span of a continuous manuscript, not an independent mini-lesson.
- ${opening}
- ${closing}
${budget ? `- ${budget}\n` : ''}- Never mention page boundaries or say “on this page,” “previous page,” or “next page.”`
}
