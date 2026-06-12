import fs from 'node:fs'
import path from 'node:path'

const inputPath = path.resolve(
  process.argv[2] ?? 'evaluation/rag/retrieval-judgments.jsonl',
)

if (!fs.existsSync(inputPath)) {
  throw new Error(`Retrieval judgment file not found: ${inputPath}`)
}

const rows = fs.readFileSync(inputPath, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line, index) => {
    try {
      return JSON.parse(line)
    } catch (error) {
      throw new Error(`Invalid JSON on line ${index + 1}: ${error.message}`)
    }
  })

if (!rows.length) throw new Error('The retrieval judgment file is empty.')

const cutoffs = [5, 10, 20]

function relevanceMap(row) {
  if (row.relevance && typeof row.relevance === 'object') {
    return new Map(
      Object.entries(row.relevance).map(([id, grade]) => [String(id), Number(grade) || 0]),
    )
  }
  return new Map((row.relevant_ids ?? []).map((id) => [String(id), 1]))
}

function dcg(rankedIds, relevance, cutoff) {
  return rankedIds.slice(0, cutoff).reduce((score, id, index) => {
    const grade = relevance.get(String(id)) ?? 0
    return score + (2 ** grade - 1) / Math.log2(index + 2)
  }, 0)
}

function evaluateRanking(row, rankedField = 'ranked_ids') {
  const rankedIds = (row[rankedField] ?? []).map(String)
  const relevance = relevanceMap(row)
  const relevantIds = new Set(
    [...relevance.entries()].filter(([, grade]) => grade > 0).map(([id]) => id),
  )
  const relevantCount = relevantIds.size
  const metrics = {}

  for (const cutoff of cutoffs) {
    const selected = rankedIds.slice(0, cutoff)
    const hits = selected.filter((id) => relevantIds.has(id)).length
    metrics[`recall@${cutoff}`] = relevantCount ? hits / relevantCount : 0
    metrics[`precision@${cutoff}`] = selected.length ? hits / selected.length : 0
  }

  const firstRelevantRank = rankedIds.findIndex((id) => relevantIds.has(id))
  metrics.mrr = firstRelevantRank >= 0 ? 1 / (firstRelevantRank + 1) : 0

  const idealGrades = [...relevance.values()].sort((a, b) => b - a)
  const idealIds = idealGrades.map((_, index) => `ideal-${index}`)
  const idealRelevance = new Map(idealIds.map((id, index) => [id, idealGrades[index]]))
  const idealDcg = dcg(idealIds, idealRelevance, 10)
  metrics['ndcg@10'] = idealDcg ? dcg(rankedIds, relevance, 10) / idealDcg : 0
  return metrics
}

function averageMetrics(results) {
  const keys = Object.keys(results[0] ?? {})
  return Object.fromEntries(keys.map((key) => [
    key,
    results.reduce((sum, result) => sum + result[key], 0) / results.length,
  ]))
}

function percentile(values, percentileValue) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
  )
  return sorted[index]
}

const current = averageMetrics(rows.map((row) => evaluateRanking(row)))
const hasBaseline = rows.every((row) => Array.isArray(row.baseline_ranked_ids))
const baseline = hasBaseline
  ? averageMetrics(rows.map((row) => evaluateRanking(row, 'baseline_ranked_ids')))
  : null
const latencies = rows
  .map((row) => Number(row.latency_ms))
  .filter((value) => Number.isFinite(value) && value >= 0)

const report = {
  file: inputPath,
  queries: rows.length,
  metrics: current,
  baselineMetrics: baseline,
  delta: baseline
    ? Object.fromEntries(Object.keys(current).map((key) => [key, current[key] - baseline[key]]))
    : null,
  latencyMs: {
    samples: latencies.length,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
  },
}

console.log(JSON.stringify(report, null, 2))
