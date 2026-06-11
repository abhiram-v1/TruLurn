import type { NeuralNetSpec, ParseResult, TruVizSpec } from './types'

/**
 * Parse a raw JSON string from a ```trueviz code fence into a typed TruVizSpec.
 * Returns { ok: true, spec } on success or { ok: false, error } on failure.
 */
export function parseTruViz(raw: string): ParseResult {
  const trimmed = raw.trim()

  if (!trimmed) {
    return { ok: false, error: 'Empty TruViz block.', raw }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { ok: false, error: 'TruViz block must be valid JSON.', raw }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'TruViz spec must be a JSON object, not an array or primitive.', raw }
  }

  const obj = parsed as Record<string, unknown>

  if (!obj.type || typeof obj.type !== 'string') {
    return { ok: false, error: 'TruViz spec must have a "type" string field.', raw }
  }

  if (obj.type === 'neural-net') {
    return validateNeuralNet(obj, raw)
  }

  return {
    ok: false,
    error: `Unknown TruViz type: "${obj.type}". Currently supported: "neural-net".`,
    raw,
  }
}

function validateNeuralNet(obj: Record<string, unknown>, raw: string): ParseResult {
  if (!Array.isArray(obj.layers)) {
    return { ok: false, error: 'Neural-net spec must have a "layers" array.', raw }
  }

  if (obj.layers.length < 2) {
    return { ok: false, error: 'Neural-net spec needs at least 2 layers.', raw }
  }

  for (let i = 0; i < obj.layers.length; i++) {
    const layer = obj.layers[i] as Record<string, unknown>
    if (!layer || typeof layer !== 'object') {
      return { ok: false, error: `Layer ${i} must be an object.`, raw }
    }
    if (typeof layer.size !== 'number' || layer.size < 1 || !Number.isInteger(layer.size)) {
      return {
        ok: false,
        error: `Layer ${i} must have a "size" field (positive integer). Got: ${JSON.stringify(layer.size)}`,
        raw,
      }
    }
  }

  return { ok: true, spec: obj as unknown as NeuralNetSpec as TruVizSpec }
}
