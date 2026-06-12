export function parseAIJson<T>(text: string): T {
  const trimmed = text.trim()

  // Only strip fences when the entire response is fenced. JSON strings may
  // legitimately contain Markdown code blocks that must remain untouched.
  let source = trimmed
  if (trimmed.startsWith('```')) {
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/)
    if (fenced?.[1]) source = fenced[1].trim()
  }

  const firstBrace = source.indexOf('{')
  const firstBracket = source.indexOf('[')
  const lastBrace = source.lastIndexOf('}')
  const lastBracket = source.lastIndexOf(']')
  const isArray = firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)

  if (isArray) {
    if (lastBracket === -1 || lastBracket <= firstBracket) {
      throw new Error('AI provider response did not contain a valid JSON array.')
    }
    return JSON.parse(source.slice(firstBracket, lastBracket + 1)) as T
  }

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('AI provider response did not contain a valid JSON object.')
  }
  return JSON.parse(source.slice(firstBrace, lastBrace + 1)) as T
}
