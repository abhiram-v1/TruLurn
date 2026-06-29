#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const fixturePath = path.join(root, 'evaluation', 'curriculum-fixtures.json')
const baselinePath = path.join(root, 'curriculum-benchmark-baseline.json')
const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}

function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function flattenTopics(curriculum) {
  const topics = []
  const visit = (topic) => {
    topics.push(topic)
    for (const child of Array.isArray(topic?.children) ? topic.children : []) visit(child)
  }
  for (const branch of Array.isArray(curriculum?.branches) ? curriculum.branches : []) {
    for (const section of Array.isArray(branch?.sections) ? branch.sections : []) {
      for (const topic of Array.isArray(section?.topics) ? section.topics : []) visit(topic)
    }
  }
  return topics
}

function evaluate(fixture, curriculum) {
  const topics = flattenTopics(curriculum)
  const text = normalize(topics.map((topic) =>
    `${topic.title ?? ''} ${topic.description ?? ''}`).join(' '))
  const recalled = fixture.expected_concepts.filter((concept) =>
    text.includes(normalize(concept)))
  const forbidden = fixture.forbidden_concepts.filter((concept) =>
    text.includes(normalize(concept)))
  const refCoverage = fixture.expects_source_refs && topics.length
    ? topics.filter((topic) =>
        Array.isArray(topic.source_refs)
        && topic.source_refs.some((ref) => /^s\d+:\d+$/.test(String(ref))),
      ).length / topics.length
    : 1
  const recall = fixture.expected_concepts.length
    ? recalled.length / fixture.expected_concepts.length
    : 1
  const score = Math.max(0, Math.round(
    recall * 70
    + refCoverage * 30
    - forbidden.length * 20,
  ))
  return {
    score,
    concept_recall: recall,
    source_ref_coverage: refCoverage,
    forbidden_topics: forbidden,
    topic_count: topics.length,
  }
}

const resultsFile = argValue('--results')
let results = []
if (resultsFile) {
  const candidates = JSON.parse(fs.readFileSync(path.resolve(resultsFile), 'utf8'))
  results = fixtures.flatMap((fixture) =>
    ['curriculum-legacy-v1', 'curriculum-v2']
      .filter((version) => candidates[fixture.id]?.[version])
      .map((version) => ({
        fixture: fixture.id,
        version,
        ...evaluate(fixture, candidates[fixture.id][version]),
      })))
} else {
  results = fixtures.map((fixture) => ({
    fixture: fixture.id,
    version: 'fixture-contract',
    score: 100,
    concept_recall: 1,
    source_ref_coverage: fixture.expects_source_refs ? 1 : null,
    forbidden_topics: [],
    topic_count: null,
  }))
}

const byVersion = results.reduce((groups, result) => {
  ;(groups[result.version] ??= []).push(result)
  return groups
}, {})
const summary = {
  run_at: new Date().toISOString(),
  fixture_count: fixtures.length,
  result_count: results.length,
  versions: Object.fromEntries(Object.entries(byVersion).map(([version, rows]) => [
    version,
    {
      samples: rows.length,
      average_score: rows.reduce((sum, row) => sum + row.score, 0) / rows.length,
      average_recall: rows.reduce((sum, row) => sum + row.concept_recall, 0) / rows.length,
      unsupported_topic_count: rows.reduce((sum, row) => sum + row.forbidden_topics.length, 0),
    },
  ])),
  results,
}

console.log(JSON.stringify(summary, null, 2))

if (process.argv.includes('--baseline')) {
  fs.writeFileSync(baselinePath, JSON.stringify(summary, null, 2))
  console.log(`Baseline saved to ${baselinePath}`)
}

if (process.argv.includes('--compare')) {
  const comparePath = path.resolve(argValue('--compare') ?? baselinePath)
  const baseline = JSON.parse(fs.readFileSync(comparePath, 'utf8'))
  const currentV2 = summary.versions['curriculum-v2']
  const baselineV2 = baseline.versions?.['curriculum-v2']
  if (currentV2 && baselineV2) {
    const scoreRegression = baselineV2.average_score - currentV2.average_score
    const recallRegression = baselineV2.average_recall - currentV2.average_recall
    if (scoreRegression > 5 || recallRegression > 0.02) {
      console.error('Curriculum benchmark regression exceeded the release gate.')
      process.exit(1)
    }
  }
}
