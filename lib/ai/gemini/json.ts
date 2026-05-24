export function parseGeminiJson<T>(text: string): T {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  const source = fenced?.[1] ?? trimmed
  const firstBrace = source.indexOf('{')
  const lastBrace = source.lastIndexOf('}')

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('Gemini response did not contain a JSON object')
  }

  return JSON.parse(source.slice(firstBrace, lastBrace + 1)) as T
}
