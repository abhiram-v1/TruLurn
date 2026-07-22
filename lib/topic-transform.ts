export type TransformAction = 'simplify' | 'deeper' | 'example'

const TRANSFORM_MATH_OUTPUT_CONTRACT = `Math formatting is strict because the lesson renderer uses remark-math:
- Use $...$ for every inline formula, for example $\\pi$, $\\mathbb{R}$, or $2+5=7$.
- Use $$ only as standalone opening and closing lines for display math.
- Never use \\(...\\) or \\[...\\] delimiters; they render as unreadable raw LaTeX in this app.
- Never place $$ on a line with prose or equation content.`

export const TRANSFORM_SYSTEM: Record<TransformAction, string> = {
  simplify: `You are TruLurn's lesson editor. Rewrite a selected passage in simpler, clearer language.
Rules:
- Preserve every concept — never drop an idea, only lower the vocabulary and sentence complexity
- Use shorter sentences. Prefer plain words over technical synonyms where possible
- Keep all math exactly as given (do not simplify or approximate LaTeX expressions)
- Write in the same style as the surrounding lesson (clear, direct, not chatty)
- The response will replace the selected passage in place, so it must fit grammatically between the supplied before/after context
- If the selection is identified as an inline fragment, return one inline phrase with no paragraph break
- Return only the clean Markdown replacement. No preamble, label, or commentary`,

  deeper: `You are TruLurn's lesson editor. Expand on a selected passage with one level more depth.
Rules:
- Explain the mechanism or reasoning behind the statement, not just what it says
- Add one concrete layer of precision: the why, the edge case, or the underlying model
- Stay tightly scoped — do not drift to adjacent topics
- Use math where it sharpens the point
- The response will replace the selected passage in place; retain its original claim while expanding it
- If the selection is identified as an inline fragment, add depth within one grammatically compatible phrase rather than starting a new paragraph
- Return only the clean Markdown replacement. No preamble or commentary`,

  example: `You are TruLurn's lesson editor. Rewrite a selected passage so it retains its explanation and integrates one concrete example.
Rules:
- Use real numbers, a specific scenario, or a step-by-step worked case
- One excellent example — not a list of examples
- Show math with LaTeX when it helps the example
- Preserve the selected passage's original concept; do not return only an example with the explanation removed
- For a complete sentence or paragraph, keep it to the original idea plus 3–8 example sentences or a compact worked solution
- For an inline fragment, integrate a compact inline example in one phrase; do not emit separate sentences or paragraphs
- The response will replace the selected passage in place, so do not refer to "the passage above"
- Return only the clean Markdown replacement. No preamble or commentary`,
}

export function buildTransformSystem(action: TransformAction): string {
  return `${TRANSFORM_SYSTEM[action]}\n\n${TRANSFORM_MATH_OUTPUT_CONTRACT}`
}

export function buildTransformUserPrompt({
  action,
  selectedText,
  topicTitle,
  contextBefore,
  contextAfter,
}: {
  action: TransformAction
  selectedText: string
  topicTitle: string
  contextBefore?: string
  contextAfter?: string
}) {
  const instructions: Record<TransformAction, string> = {
    simplify: 'Rewrite this in simpler language without losing any concept.',
    deeper: 'Expand this with one level more depth and precision.',
    example: 'Rewrite this to preserve the explanation and integrate one concrete example.',
  }
  const selectionShape = inferSelectionShape(contextBefore, contextAfter)
  const shapeRule = selectionShape === 'inline'
    ? 'This selection is an inline fragment. The replacement must be one inline phrase, with no paragraph break, that connects grammatically to both context snippets.'
    : 'This selection is a complete sentence or passage. The replacement may use normal Markdown paragraphs when useful.'

  return `Topic: ${topicTitle}

Selection shape: ${selectionShape}
${shapeRule}

Context immediately before the selection (context only; do not rewrite):
${contextBefore?.trim() || '[start of section]'}

<selected_passage>
${selectedText}
</selected_passage>

Context immediately after the selection (context only; do not rewrite):
${contextAfter?.trim() || '[end of section]'}

${instructions[action]}
Return only the replacement for <selected_passage>.`
}

export function inferSelectionShape(contextBefore?: string, contextAfter?: string): 'inline' | 'passage' {
  const before = contextBefore?.trim() ?? ''
  const after = contextAfter?.trim() ?? ''
  if (!before && !after) return 'passage'
  const beginsAtBoundary = !before || /(?:[.!?]\s*|[:;]\s*)$/u.test(before)
  const endsAtBoundary = !after || /^(?:[.!?;,):\]]|[A-Z])/u.test(after)
  return beginsAtBoundary && endsAtBoundary ? 'passage' : 'inline'
}

function wordCount(value: string) {
  return value.trim().split(/\s+/u).filter(Boolean).length
}

export function validateTransformResult(
  action: TransformAction,
  selectedText: string,
  result: string,
  context?: { before?: string; after?: string },
): string[] {
  const issues: string[] = []
  const trimmed = result.trim()
  const selectedWords = wordCount(selectedText)
  const resultWords = wordCount(trimmed)

  if (trimmed.length < 12) issues.push('The replacement is too short to be useful.')
  if (/^```[\s\S]*```$/u.test(trimmed)) issues.push('Return Markdown directly, without wrapping it in a code fence.')
  if (/\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/u.test(trimmed)) {
    issues.push('Use $...$ for inline math and standalone $$ lines for display math; never use \\(...\\) or \\[...\\].')
  }
  const mixedDisplayFence = trimmed.split('\n').some((line) => line.includes('$$') && line.trim() !== '$$')
  if (mixedDisplayFence) issues.push('Put each display-math $$ delimiter on its own line.')
  if (/^(?:here(?:'s| is)|simplified version|expanded version|example:)/iu.test(trimmed)) {
    issues.push('Remove the conversational preamble or output label.')
  }
  if (trimmed.replace(/\s+/gu, ' ') === selectedText.trim().replace(/\s+/gu, ' ')) {
    issues.push('The replacement must materially change the selected passage.')
  }

  if (inferSelectionShape(context?.before, context?.after) === 'inline') {
    if (/\n/u.test(trimmed)) issues.push('An inline selection must return one inline phrase without paragraph breaks.')
    if (resultWords > Math.max(40, selectedWords * 5)) issues.push('The inline replacement is too long to fit its sentence.')
    if (context?.after?.trim() && /^[\p{L}\p{N}`*_]/u.test(context.after.trim()) && /[.!?]$/u.test(trimmed)) {
      issues.push('The inline replacement must connect to the following words without terminal punctuation.')
    }
  }

  if (action === 'simplify' && resultWords > selectedWords * 1.7 + 12) {
    issues.push('The simplified replacement became substantially longer than the original.')
  }
  if (action === 'deeper' && resultWords < selectedWords + Math.min(10, Math.max(4, Math.ceil(selectedWords * 0.15)))) {
    issues.push('The deeper replacement needs another concrete layer of explanation.')
  }
  if (action === 'example') {
    if (resultWords < selectedWords + 6) issues.push('The example replacement must retain the idea and add a worked case.')
    if (!/(?:\d|for example|suppose|consider|imagine|such as|let\s+\w+\s*=|if\s+)/iu.test(trimmed)) {
      issues.push('The replacement needs a concrete scenario, value, or worked case.')
    }
  }

  return issues
}
