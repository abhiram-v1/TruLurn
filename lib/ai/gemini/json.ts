export function parseGeminiJson<T>(text: string): T {
  const trimmed = text.trim()

  // Strip markdown code fences if present (```json ... ``` or ``` ... ```)
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  const source = fenced?.[1] ?? trimmed

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
