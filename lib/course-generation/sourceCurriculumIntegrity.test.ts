import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  enforceSourceGroundedCurriculum,
  validateSourceGroundedCurriculum,
  validateSourceGroundedMap,
} from './sourceCurriculumIntegrity.ts'

const sourceText = `Source 1: transactions.md
# Transaction Basics
Transactions group database operations into one logical unit. Atomicity ensures
that either every operation succeeds or none of them does. Isolation controls
how concurrent transactions observe one another.`

const narrowProfile = {
  subject_domain: 'Database Management Systems',
  educational_level: 'undergraduate',
  document_type: 'chapter',
  scope: {
    covered_topics: ['Transaction basics'],
    full_subject: 'Database Management Systems',
    coverage: 'narrow',
  },
  teaching_style: {
    explanation_pattern: 'definition then example',
    example_structure: 'worked examples',
    progression: 'conceptual',
    tone: 'formal',
    depth_expectation: 'apply',
  },
  terminology: [],
  emphasized_concepts: [],
  recurring_examples: [],
  exam_signals: [],
  implied_prerequisites: ['Relational algebra'],
  addressed_misconceptions: [],
  reconstruction: {
    prerequisite_topics: ['Database tables'],
    dependent_topics: ['Distributed transactions'],
    recommended_course_scope: 'Transactions as covered by this chapter.',
  },
} as any

function topic(id: string, title = 'Transaction Basics') {
  return {
    id,
    title,
    description: `Learn ${title}.`,
    prerequisites: [],
    prerequisite_strength: {},
    depth: 'medium',
    estimated_pages: 2,
    node_type: 'learning_unit',
    importance: 'core',
    role: 'foundation',
    spine_candidate: false,
    spine_level: 0,
    source_coverage: 'covered',
    concept_group: 'current',
    source_anchor: `Source 1 - Transaction Basics`,
    children: [],
    initial_state: 'locked',
  }
}

function curriculum(topics = [topic('transactions')]) {
  return {
    title: 'Database Transactions',
    complexity: 'narrow',
    source_sequence_policy: 'preserve_uploaded_source_order',
    structure_reasoning: 'The source teaches one cohesive transaction arc.',
    branches: [{
      id: 'transactions',
      title: 'Transactions',
      description: 'Source-covered transaction concepts.',
      state: 'not_started',
      sections: [{ title: 'Core', topics }],
    }],
    out_of_scope: {
      assumed_prerequisites: [],
      mentioned_followups: [],
    },
    source_limitations: [],
  }
}

test('accepts a narrow source curriculum and merges source-profile boundaries', () => {
  const candidate = curriculum()
  const enforced = enforceSourceGroundedCurriculum(candidate, {
    sourceText,
    sourceProfile: narrowProfile,
  })

  assert.equal(enforced.source_validation_report.valid, true)
  assert.deepEqual(enforced.out_of_scope.assumed_prerequisites, [
    'Relational algebra',
    'Database tables',
  ])
  assert.deepEqual(enforced.out_of_scope.mentioned_followups, [
    'Distributed transactions',
  ])
})

test('rejects inferred canonical topics', () => {
  const candidate = curriculum()
  candidate.branches[0].sections[0].topics[0].source_coverage = 'inferred'

  const report = validateSourceGroundedCurriculum(candidate, {
    sourceText,
    sourceProfile: narrowProfile,
  })

  assert.equal(report.valid, false)
  assert.ok(report.issues.some((issue) => issue.code === 'noncovered_topic'))
})

test('rejects missing and invalid source anchors', () => {
  const missing = curriculum()
  missing.branches[0].sections[0].topics[0].source_anchor = ''
  const missingReport = validateSourceGroundedCurriculum(missing, {
    sourceText,
    sourceProfile: narrowProfile,
  })
  assert.ok(missingReport.issues.some((issue) => issue.code === 'missing_source_anchor'))

  const invalid = curriculum()
  invalid.branches[0].sections[0].topics[0].source_anchor = 'Source 9 - Transaction Basics'
  const invalidReport = validateSourceGroundedCurriculum(invalid, {
    sourceText,
    sourceProfile: narrowProfile,
  })
  assert.ok(invalidReport.issues.some((issue) => issue.code === 'invalid_source_reference'))

  const invented = curriculum()
  invented.branches[0].sections[0].topics[0].source_anchor = 'Source 1 - Neural Networks'
  const inventedReport = validateSourceGroundedCurriculum(invented, {
    sourceText,
    sourceProfile: narrowProfile,
  })
  assert.ok(inventedReport.issues.some((issue) => issue.code === 'unsupported_anchor_locator'))
})

test('rejects assumed prerequisites promoted into canonical topics', () => {
  const candidate = curriculum([topic('relational-algebra', 'Relational Algebra')])
  assert.throws(
    () => enforceSourceGroundedCurriculum(candidate, {
      sourceText,
      sourceProfile: narrowProfile,
    }),
    /promotes out-of-scope material/,
  )
})

test('rejects excessive Atlas-level fragmentation for a narrow chapter', () => {
  const candidate = curriculum(
    Array.from({ length: 6 }, (_, index) =>
      topic(`transaction-part-${index + 1}`, `Transaction Part ${index + 1}`)),
  )
  const report = validateSourceGroundedCurriculum(candidate, {
    sourceText,
    sourceProfile: narrowProfile,
  })

  assert.equal(report.valid, false)
  assert.ok(report.issues.some((issue) => issue.code === 'excessive_root_topics'))
})

test('allows a reasonably sized partial multi-source curriculum', () => {
  const partialProfile = {
    ...narrowProfile,
    document_type: 'lecture_notes',
    scope: {
      ...narrowProfile.scope,
      covered_topics: ['Indexes', 'Transactions', 'Recovery'],
      coverage: 'partial',
    },
  }
  const candidate = curriculum([
    topic('indexes', 'Indexes'),
    topic('transactions', 'Transactions'),
    topic('recovery', 'Recovery'),
    topic('worked-examples', 'Worked Examples'),
  ])
  const twoSources = `Source 1: database-notes.md
# Indexes
Indexes speed up database lookup.
# Transactions
Transactions group operations into one logical unit.

---

Source 2: recovery.md
# Recovery
Recovery uses logs and checkpoints.
# Worked Examples
A checkpoint recovery example is worked step by step.`
  candidate.branches[0].sections[0].topics[0].source_anchor = 'Source 1 - Indexes'
  candidate.branches[0].sections[0].topics[1].source_anchor = 'Source 1 - Transactions'
  candidate.branches[0].sections[0].topics[2].source_anchor = 'Source 2 - Recovery'
  candidate.branches[0].sections[0].topics[3].source_anchor = 'Source 2 - Worked Examples'

  const report = validateSourceGroundedCurriculum(candidate, {
    sourceText: twoSources,
    sourceProfile: partialProfile,
  })

  assert.equal(report.valid, true, JSON.stringify(report.issues))
})

test('rejects Atlas map topics outside the validated curriculum', () => {
  const candidate = curriculum()
  const issues = validateSourceGroundedMap(candidate, {
    topics: [
      { id: 'transactions', title: 'Transaction Basics' },
      { id: 'distributed-transactions', title: 'Distributed Transactions' },
    ],
  })

  assert.ok(issues.some((issue) => issue.code === 'map_topic_not_in_curriculum'))
})
