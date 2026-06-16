import type { PersonaLessonContext } from './types'

export function buildTextbookContinuityDirective(context?: PersonaLessonContext) {
  if (!context) return ''

  const opening = context.continuesFromPrevious
    ? '- Begin as the direct continuation of the preceding explanation. Do not reintroduce the topic, manufacture a new hook, or recap the page merely because the screen changed.'
    : '- Begin at the planned manuscript boundary. Introduce only what this span genuinely starts.'
  const closing = context.continuesToNext
    ? '- Do not conclude the topic, summarize the page, add a final takeaway, or force a challenge. Reach the planned natural pause and stop with the reasoning ready to continue.'
    : '- This is the final span of the topic, so close the overall explanation naturally after the assigned material is complete.'
  const budget = context.targetWords
    ? `- Treat ${context.targetWords} words as an upper budget, not a quota. You may continue up to ${context.softMaxWords ?? context.targetWords} words only to finish a nearly complete concept or worked step.`
    : ''

  return `TEXTBOOK CONTINUITY:
- This page is a physical span of one continuous manuscript, not an independent mini-lesson.
${opening}
${closing}
${budget}
- A page may finish one concept and begin the next when useful space remains.
- Never mention the page break or use phrases such as "on this page", "in the previous page", or "in the next page".`
}
