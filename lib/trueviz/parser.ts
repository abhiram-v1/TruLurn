import type { NeuralNetSpec, DataChartSpec, ParseResult, TruVizSpec } from './types'

const CHART_TYPES = new Set(['bar', 'line', 'scatter', 'pie', 'histogram', 'area'])

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

  if (obj.type === 'data-chart') {
    return validateDataChart(obj, raw)
  }

  return {
    ok: false,
    error: `Unknown diagram type: "${obj.type}". Supported: "neural-net", "data-chart".`,
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

function validateDataChart(obj: Record<string, unknown>, raw: string): ParseResult {
  if (!obj.chartType || typeof obj.chartType !== 'string' || !CHART_TYPES.has(obj.chartType)) {
    return {
      ok: false,
      error: `data-chart must have a "chartType" field set to one of: ${[...CHART_TYPES].join(', ')}.`,
      raw,
    }
  }

  if (!Array.isArray(obj.data) || obj.data.length === 0) {
    return { ok: false, error: 'data-chart "data" must be a non-empty array of row objects.', raw }
  }

  if (obj.data.length > 200) {
    return { ok: false, error: 'data-chart "data" exceeds the 200-row maximum.', raw }
  }

  const chartType = obj.chartType

  if (chartType !== 'pie') {
    const xAxis = obj.xAxis as Record<string, unknown> | undefined
    if (!xAxis || typeof xAxis.key !== 'string' || !xAxis.key) {
      return { ok: false, error: 'data-chart requires an "xAxis.key" string for non-pie charts.', raw }
    }

    if (!Array.isArray(obj.series) || obj.series.length === 0) {
      return { ok: false, error: 'data-chart requires at least one entry in "series" for non-pie charts.', raw }
    }

    if (obj.series.length > 8) {
      return { ok: false, error: 'data-chart "series" exceeds the 8-series maximum.', raw }
    }

    for (let i = 0; i < (obj.series as unknown[]).length; i++) {
      const s = (obj.series as Record<string, unknown>[])[i]
      if (!s || typeof s.key !== 'string' || !s.key) {
        return { ok: false, error: `data-chart series[${i}] must have a "key" string.`, raw }
      }
    }
  } else {
    const firstRow = (obj.data as Record<string, unknown>[])[0]
    if (!('name' in firstRow) || !('value' in firstRow)) {
      return {
        ok: false,
        error: 'data-chart pie type requires data rows with "name" and "value" keys.',
        raw,
      }
    }
  }

  return { ok: true, spec: obj as unknown as DataChartSpec as TruVizSpec }
}
