#!/usr/bin/env node
// Benchmark script for the lesson quality evaluator.
//
// Usage:
//   node scripts/benchmark-lesson-quality.mjs [--baseline] [--compare <file>]
//
// --baseline   Write current scores to benchmark-baseline.json (run after a validated change)
// --compare    Compare against a saved baseline file
//
// The script evaluates a fixed set of lesson fixtures against the quality
// contract without making any AI calls. It measures: acceptance rate, average
// score, failure rates by dimension, and known-pattern detection rates.

import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const baselineFile = path.join(__dirname, '..', 'benchmark-baseline.json')

// ── Fixtures ────────────────────────────────────────────────────────────────
// Each fixture declares the page input and the expected evaluation outcome.
// Add a fixture for every confirmed production failure.

const FIXTURES = [
  {
    id: 'clean_full_page',
    description: 'Well-formed full-page lesson — should be accepted',
    expectedAccepted: true,
    page: {
      page_number: 1,
      content: 'Machine learning earns its place in four situations.\n\nFirst, when writing the rules yourself becomes a burden. A spam filter is a good example: you could write rules, but spammers adapt, rules grow, exceptions accumulate, and you are maintaining a bureaucracy instead of a filter.\n\nSecond, when the pattern changes over time and fixed rules cannot keep up.\n\nThird, when no known algorithm exists — speech recognition is the textbook case.\n\nFourth, when the goal is discovery: you want to find patterns in the data rather than apply ones you already know, such as segmenting customers into groups you did not define in advance.\n\n> **Mental model:** Use hand-written rules when the rules are already clear to you; use machine learning when the source of the patterns is the data itself.\n\nMachine learning does not replace thinking. It replaces the part of thinking that turns into an ever-growing checklist.',
      summary: 'When machine learning beats rule-writing: four situations with clear reasoning.',
      key_concepts: ['machine learning', 'automation', 'adaptability', 'data mining'],
      topic_depth: 'medium',
      concept_kind: 'mechanism',
      content_kind: 'full_page',
      should_generate_page: true,
      decision_reason: 'Full standalone lesson.',
      estimated_length: 'medium',
      requires_quiz: false,
      covered_concepts: ['machine learning', 'automation', 'adaptability'],
      reused_concepts: [],
      reminder_concepts: [],
      example_refs: [],
      sections: [{
        type: 'core',
        title: 'When learning beats rules',
        content: 'Machine learning is useful when the pattern must be inferred from data because maintaining an explicit rule set would be brittle, incomplete, or unable to adapt.',
      }],
      page_mode: 'micro',
      core_realization: 'Machine learning is appropriate when useful decision patterns must come from data rather than an ever-growing hand-written rule set.',
    },
    topic: { title: 'When to Use Machine Learning', description: 'Four situations where ML beats rule-writing' },
    pageNumber: 1,
    sourceGrounded: false,
  },
  {
    id: 'source_narration',
    description: 'Page that narrates source instead of teaching — should be rejected',
    expectedAccepted: false,
    page: {
      page_number: 1,
      content: 'The source says machine learning is useful when manual rule-writing becomes burdensome. The source identifies spam filters as an example. The source also notes that evolving spam tactics are one reason learning helps.',
      summary: 'Source says ML is useful.',
      key_concepts: ['machine learning'],
      topic_depth: 'shallow',
      concept_kind: 'definition',
      content_kind: 'full_page',
      should_generate_page: true,
      decision_reason: 'Full standalone lesson.',
      estimated_length: 'short',
      requires_quiz: false,
      covered_concepts: [],
      reused_concepts: [],
      reminder_concepts: [],
      example_refs: [],
      sections: [],
    },
    topic: { title: 'When to Use Machine Learning', description: '' },
    pageNumber: 1,
    sourceGrounded: true,
  },
  {
    id: 'throat_clearing',
    description: 'Page opening with "In this page we will cover" — should be rejected',
    expectedAccepted: false,
    page: {
      page_number: 1,
      content: 'In this page, we will cover when machine learning is the right tool to use.\n\nMachine learning is useful in four situations: automation, adaptability, complex problems, and data mining. Each situation represents a case where writing rules manually becomes impractical or impossible.',
      summary: 'Covers when ML is appropriate.',
      key_concepts: ['machine learning'],
      topic_depth: 'shallow',
      concept_kind: 'mechanism',
      content_kind: 'section',
      should_generate_page: true,
      decision_reason: 'Brief intro section.',
      estimated_length: 'short',
      requires_quiz: false,
      covered_concepts: ['machine learning'],
      reused_concepts: [],
      reminder_concepts: [],
      example_refs: [],
      sections: [],
    },
    topic: { title: 'When to Use Machine Learning', description: '' },
    pageNumber: 1,
    sourceGrounded: false,
  },
  {
    id: 'word_count_too_low',
    description: 'Page with less than 70 words — should be rejected',
    expectedAccepted: false,
    page: {
      page_number: 1,
      content: 'Machine learning is useful.',
      summary: 'Brief.',
      key_concepts: ['machine learning'],
      topic_depth: 'shallow',
      concept_kind: 'definition',
      content_kind: 'full_page',
      should_generate_page: true,
      decision_reason: 'Full page.',
      estimated_length: 'short',
      requires_quiz: false,
      covered_concepts: [],
      reused_concepts: [],
      reminder_concepts: [],
      example_refs: [],
      sections: [],
    },
    topic: { title: 'Machine Learning Overview', description: '' },
    pageNumber: 1,
    sourceGrounded: false,
  },
  {
    id: 'no_continuity_page2',
    description: 'Page 2 with no continuity signal when prior pages exist — should warn',
    expectedAccepted: false,
    page: {
      page_number: 2,
      content: 'Gradient descent is the optimization algorithm used to train most neural networks. It works by computing the gradient of the loss function and taking small steps in the direction that reduces the loss.\n\nThe update rule is: parameters = parameters - learning_rate * gradient. This iterative process continues until the loss converges to a minimum or a maximum number of steps is reached.',
      summary: 'Gradient descent for neural network training.',
      key_concepts: ['gradient descent', 'optimization', 'loss function'],
      topic_depth: 'medium',
      concept_kind: 'mechanism',
      content_kind: 'full_page',
      should_generate_page: true,
      decision_reason: 'Full page.',
      estimated_length: 'medium',
      requires_quiz: false,
      covered_concepts: ['gradient descent'],
      reused_concepts: [],
      reminder_concepts: [],
      example_refs: [],
      sections: [],
    },
    topic: { title: 'Neural Network Training', description: '' },
    pageNumber: 2,
    sourceGrounded: false,
    previousPages: [{ content: 'Neural networks are computational models inspired by the brain.', key_concepts: ['neural network'], focus: 'Introduction' }],
  },
]

// ── Evaluation ───────────────────────────────────────────────────────────────

async function runBenchmark() {
  // Dynamically import the evaluator (TypeScript stripped at runtime by Node --experimental-strip-types)
  // The script is run via node scripts/benchmark-lesson-quality.mjs from the repo root,
  // so the path alias @/ maps to the project root. We use a relative path here for
  // direct Node invocation without a bundler.
  const { evaluateLessonQuality } = await import('../lib/topic-pages/lessonQuality.ts')

  const results = []
  let passed = 0
  let failed = 0

  for (const fixture of FIXTURES) {
    const report = evaluateLessonQuality({
      page: fixture.page,
      topic: fixture.topic,
      pageNumber: fixture.pageNumber,
      previousPages: fixture.previousPages ?? [],
      sourceGrounded: fixture.sourceGrounded ?? false,
    })

    const outcomeCorrect = report.accepted === fixture.expectedAccepted
    if (outcomeCorrect) {
      passed++
    } else {
      failed++
    }

    results.push({
      id: fixture.id,
      description: fixture.description,
      expected_accepted: fixture.expectedAccepted,
      actual_accepted: report.accepted,
      overall_score: report.overall_score,
      threshold: report.threshold,
      outcome: outcomeCorrect ? 'PASS' : 'FAIL',
      issues: report.issues.map((i) => `${i.code}(${i.severity})`),
    })
  }

  const acceptanceRate = Math.round((passed / FIXTURES.length) * 100)

  console.log('\n=== Lesson Quality Benchmark ===\n')
  for (const r of results) {
    const icon = r.outcome === 'PASS' ? '✓' : '✗'
    console.log(`${icon} [${r.id}] score=${r.overall_score} accepted=${r.actual_accepted} issues=[${r.issues.join(', ')}]`)
  }
  console.log(`\nResult: ${passed}/${FIXTURES.length} passed (${acceptanceRate}%)`)

  const summary = {
    run_at: new Date().toISOString(),
    fixtures: FIXTURES.length,
    passed,
    failed,
    acceptance_rate: acceptanceRate,
    results,
  }

  const args = process.argv.slice(2)

  if (args.includes('--baseline')) {
    fs.writeFileSync(baselineFile, JSON.stringify(summary, null, 2))
    console.log(`\nBaseline saved to ${baselineFile}`)
  }

  if (args.includes('--compare')) {
    const compareFile = args[args.indexOf('--compare') + 1] ?? baselineFile
    if (!fs.existsSync(compareFile)) {
      console.error(`No baseline file found at ${compareFile}. Run with --baseline first.`)
      process.exit(1)
    }
    const baseline = JSON.parse(fs.readFileSync(compareFile, 'utf8'))
    console.log('\n=== Comparison vs Baseline ===\n')
    for (const current of results) {
      const base = baseline.results?.find((r) => r.id === current.id)
      if (!base) {
        console.log(`  NEW  [${current.id}] score=${current.overall_score}`)
        continue
      }
      const scoreDelta = current.overall_score - base.overall_score
      const icon = scoreDelta >= 0 ? '+' : '-'
      const changed = current.outcome !== base.outcome ? ' ← OUTCOME CHANGED' : ''
      console.log(`  ${icon}${Math.abs(scoreDelta).toFixed(0).padStart(3)} [${current.id}] ${base.overall_score}→${current.overall_score}${changed}`)
    }
    console.log(`\nBaseline: ${baseline.passed}/${baseline.fixtures} passed | Current: ${passed}/${FIXTURES.length} passed`)
    if (failed > baseline.failed) {
      console.error('\n[REGRESSION] More fixtures failing than baseline. Review changes before shipping.')
      process.exit(1)
    }
  }

  if (failed > 0) {
    process.exit(1)
  }
}

runBenchmark().catch((err) => {
  console.error('Benchmark failed:', err)
  process.exit(1)
})
