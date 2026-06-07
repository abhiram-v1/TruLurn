export function parseGeminiJson<T>(text: string): T {
  const trimmed = text.trim()

  // Only strip code fences when the ENTIRE response is wrapped in them (starts with ```).
  // Do NOT apply when the response is JSON that contains code blocks inside string values —
  // the greedy regex would incorrectly extract the inner code instead of the outer JSON.
  let source = trimmed
  if (trimmed.startsWith('```')) {
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/)
    if (fenced?.[1]) source = fenced[1].trim()
  }

  const firstBrace   = source.indexOf('{')
  const firstBracket = source.indexOf('[')
  const lastBrace    = source.lastIndexOf('}')
  const lastBracket  = source.lastIndexOf(']')

  // Determine whether the outermost structure is an array or an object.
  // Pick whichever start character appears first.
  const isArray =
    firstBracket !== -1 &&
    (firstBrace === -1 || firstBracket < firstBrace)

  if (isArray) {
    if (lastBracket === -1 || lastBracket <= firstBracket) {
      throw new Error('Response did not contain a valid JSON array.')
    }
    return JSON.parse(source.slice(firstBracket, lastBracket + 1)) as T
  }

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('Response did not contain a valid JSON object.')
  }
  return JSON.parse(source.slice(firstBrace, lastBrace + 1)) as T
}
