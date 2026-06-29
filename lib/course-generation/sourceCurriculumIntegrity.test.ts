import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  classifySourceCurriculumIssues,
  enforceSourceGroundedCurriculum,
  enforceSourceGroundedMap,
  repairMechanicalSourceGroundedCurriculum,
  SourceCurriculumIntegrityError,
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

const compactSource = {
  schema_version: 'curriculum-source-v1',
  source_fingerprint: 'transactions',
  compaction_version: 'v1.1',
  original_char_count: sourceText.length,
  compact_char_count: 120,
  sources: [{
    source_id: 'doc-1',
    title: 'transactions.md',
    headings: ['Transaction Basics'],
    sections: [{
      source_id: 'doc-1',
      id: 's1:1',
      heading_path: ['Transaction Basics'],
      ordinal: 0,
      opening_excerpt: 'Transactions group operations into one logical unit.',
      key_definitions: [],
      enumerations: [],
      learning_objectives: [],
      code_samples: [],
      table_summaries: [],
      original_char_count: 120,
    }],
  }],
  coverage_report: {
    source_count: 1,
    represented_source_count: 1,
    heading_count: 1,
    represented_heading_count: 1,
    omitted_sections: [],
    valid: true,
    budget_chars: 0,
    within_budget: true,
    trimmed_section_count: 0,
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
    source_refs: ['s1:1'],
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

test('hydrates source coverage instead of asking the model to decide it', () => {
  const candidate = curriculum()
  candidate.branches[0].sections[0].topics[0].source_coverage = 'inferred'

  const enforced = enforceSourceGroundedCurriculum(candidate, {
    sourceText,
    sourceProfile: narrowProfile,
    compactCurriculumSource: compactSource,
  })

  assert.equal(enforced.branches[0].sections[0].topics[0].source_coverage, 'covered')
  assert.equal(enforced.source_validation_report.valid, true)
})

test('rejects missing and invalid stable source refs', () => {
  const missing = curriculum()
  missing.branches[0].sections[0].topics[0].source_refs = []
  const missingReport = validateSourceGroundedCurriculum(missing, {
    sourceText,
    sourceProfile: narrowProfile,
    compactCurriculumSource: compactSource,
  })
  assert.ok(missingReport.issues.some((issue) => issue.code === 'missing_source_refs'))

  const invalid = curriculum()
  invalid.branches[0].sections[0].topics[0].source_refs = ['s9:1']
  const invalidReport = validateSourceGroundedCurriculum(invalid, {
    sourceText,
    sourceProfile: narrowProfile,
    compactCurriculumSource: compactSource,
  })
  assert.ok(invalidReport.issues.some((issue) => issue.code === 'invalid_source_ref'))
})

test('classifies mechanical and substantive failures separately', () => {
  const classified = classifySourceCurriculumIssues([
    { code: 'duplicate_topic_id', message: 'duplicate' },
    { code: 'missing_source_refs', message: 'missing' },
    { code: 'missing_topics', message: 'empty' },
  ])
  assert.deepEqual(classified.mechanical.map((issue) => issue.code), ['duplicate_topic_id'])
  assert.deepEqual(classified.substantive.map((issue) => issue.code), ['missing_source_refs'])
  assert.deepEqual(classified.irrecoverable.map((issue) => issue.code), ['missing_topics'])
})

test('mechanical repair does not delete topics with substantive citation failures', () => {
  const candidate = curriculum()
  candidate.branches[0].sections[0].topics[0].source_refs = []
  const report = validateSourceGroundedCurriculum(candidate, {
    sourceText,
    sourceProfile: narrowProfile,
    compactCurriculumSource: compactSource,
  })
  repairMechanicalSourceGroundedCurriculum(candidate, report.issues, {
    compactCurriculumSource: compactSource,
  })
  assert.equal(candidate.branches[0].sections[0].topics.length, 1)
})

test('flags a topic whose valid citation does not support its content', () => {
  const candidate = curriculum([topic('neural-networks', 'Neural Networks')])
  const report = validateSourceGroundedCurriculum(candidate, {
    sourceText,
    sourceProfile: narrowProfile,
    compactCurriculumSource: compactSource,
  })
  assert.ok(report.issues.some((issue) => issue.code === 'topic_not_supported_by_source'))
})

test('does not auto-approve a topic whose title and description carry no substantive token', () => {
  // "Overview" is itself a stop word, and the description is blanked out — so
  // neither field has anything checkable against the evidence. This must not
  // be treated as automatically supported.
  const overview = topic('overview-topic', 'Overview')
  overview.description = ''
  const candidate = curriculum([overview])
  const report = validateSourceGroundedCurriculum(candidate, {
    sourceText,
    sourceProfile: narrowProfile,
    compactCurriculumSource: compactSource,
  })
  assert.ok(report.issues.some((issue) => issue.code === 'topic_not_supported_by_source'))
})

test('flags backward source traversal when uploaded order is authoritative', () => {
  const orderedCompact = {
    ...compactSource,
    sources: [
      compactSource.sources[0],
      {
        source_id: 'doc-2',
        title: 'isolation.md',
        headings: ['Isolation'],
        sections: [{
          ...compactSource.sources[0].sections[0],
          source_id: 'doc-2',
          id: 's2:1',
          heading_path: ['Isolation'],
          opening_excerpt: 'Isolation controls concurrent transaction visibility.',
        }],
      },
    ],
    coverage_report: {
      ...compactSource.coverage_report,
      source_count: 2,
      represented_source_count: 2,
      heading_count: 2,
      represented_heading_count: 2,
    },
  }
  const isolation = topic('isolation', 'Isolation')
  isolation.description = 'Concurrent transaction visibility.'
  isolation.source_refs = ['s2:1']
  const transactions = topic('transactions', 'Transaction Basics')
  transactions.source_refs = ['s1:1']
  const candidate = curriculum([isolation, transactions])
  const report = validateSourceGroundedCurriculum(candidate, {
    sourceText,
    sourceProfile: narrowProfile,
    compactCurriculumSource: orderedCompact,
  })
  assert.ok(report.issues.some((issue) => issue.code === 'source_order_violation'))
})

test('rejects assumed prerequisites promoted into canonical topics', () => {
  const candidate = curriculum([topic('relational-algebra', 'Relational Algebra')])
  candidate.out_of_scope.assumed_prerequisites = ['Relational Algebra']
  const report = validateSourceGroundedCurriculum(candidate, {
    sourceText,
    sourceProfile: narrowProfile,
  })
  assert.ok(report.issues.some((issue) => issue.code === 'out_of_scope_promoted'))
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
  const indexesTopic = topic('indexes', 'Indexes')
  indexesTopic.source_refs = ['s1:1']
  indexesTopic.source_anchor = 'Source 1 - Indexes'
  const transactionsTopic = topic('transactions', 'Transactions')
  transactionsTopic.source_refs = ['s1:2']
  transactionsTopic.source_anchor = 'Source 1 - Transactions'
  const recoveryTopic = topic('recovery', 'Recovery')
  recoveryTopic.source_refs = ['s2:1']
  recoveryTopic.source_anchor = 'Source 2 - Recovery'
  const workedExamplesTopic = topic('worked-examples', 'Worked Examples')
  workedExamplesTopic.source_refs = ['s2:2']
  workedExamplesTopic.source_anchor = 'Source 2 - Worked Examples'
  const candidate = curriculum([indexesTopic, transactionsTopic, recoveryTopic, workedExamplesTopic])

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

  // A real compact evidence index, so this test exercises the actual
  // ref-resolution + support checks rather than the no-index legacy fallback.
  const twoSourceCompact = {
    ...compactSource,
    sources: [
      {
        source_id: 'doc-1',
        title: 'database-notes.md',
        headings: ['Indexes', 'Transactions'],
        sections: [
          {
            source_id: 'doc-1', id: 's1:1', heading_path: ['Indexes'], ordinal: 0,
            opening_excerpt: 'Indexes speed up database lookup.',
            key_definitions: [], enumerations: [], learning_objectives: [],
            code_samples: [], table_summaries: [], original_char_count: 60,
          },
          {
            source_id: 'doc-1', id: 's1:2', heading_path: ['Transactions'], ordinal: 1,
            opening_excerpt: 'Transactions group operations into one logical unit.',
            key_definitions: [], enumerations: [], learning_objectives: [],
            code_samples: [], table_summaries: [], original_char_count: 60,
          },
        ],
      },
      {
        source_id: 'doc-2',
        title: 'recovery.md',
        headings: ['Recovery', 'Worked Examples'],
        sections: [
          {
            source_id: 'doc-2', id: 's2:1', heading_path: ['Recovery'], ordinal: 0,
            opening_excerpt: 'Recovery uses logs and checkpoints.',
            key_definitions: [], enumerations: [], learning_objectives: [],
            code_samples: [], table_summaries: [], original_char_count: 60,
          },
          {
            source_id: 'doc-2', id: 's2:2', heading_path: ['Worked Examples'], ordinal: 1,
            opening_excerpt: 'A checkpoint recovery example is worked step by step.',
            key_definitions: [], enumerations: [], learning_objectives: [],
            code_samples: [], table_summaries: [], original_char_count: 60,
          },
        ],
      },
    ],
    coverage_report: {
      ...compactSource.coverage_report,
      source_count: 2,
      represented_source_count: 2,
      heading_count: 4,
      represented_heading_count: 4,
    },
  }

  const report = validateSourceGroundedCurriculum(candidate, {
    sourceText: twoSources,
    sourceProfile: partialProfile,
    compactCurriculumSource: twoSourceCompact,
  })

  assert.equal(report.valid, true, JSON.stringify(report.issues))
})

test('a topic with refs but no compact index and no legacy anchor is treated as unverifiable', () => {
  const noAnchor = topic('mystery')
  noAnchor.source_anchor = ''
  const candidate = curriculum([noAnchor])
  const report = validateSourceGroundedCurriculum(candidate, {
    sourceText,
    sourceProfile: narrowProfile,
    // No compactCurriculumSource: nothing to verify the ref against, and no
    // legacy anchor to fall back on trusting.
  })
  assert.ok(report.issues.some((issue) => issue.code === 'missing_source_refs'))
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

test('enforceSourceGroundedMap silently drops phantom map topics not in the curriculum', () => {
  const candidate = curriculum() // single 'transactions' topic
  const map = {
    topics: [
      { id: 'transactions', title: 'Transaction Basics' },
      { id: 'hallucinated', title: 'Invented Topic' },
    ],
  }
  const result = enforceSourceGroundedMap(candidate, map)
  assert.deepEqual(result.topics.map((t: any) => t.id), ['transactions'])
})

test('enforceSourceGroundedMap refuses to persist when the map dropped an approved curriculum topic', () => {
  // The curriculum approved two topics; the map only produced one — there is
  // no safe way to synthesise the missing one's graph metadata, so this must
  // fail loudly rather than silently produce an incomplete course.
  const candidate = curriculum([topic('transactions'), topic('isolation', 'Isolation')])
  const map = { topics: [{ id: 'transactions', title: 'Transaction Basics' }] }
  assert.throws(
    () => enforceSourceGroundedMap(candidate, map),
    (error: unknown) => {
      assert.ok(error instanceof SourceCurriculumIntegrityError)
      assert.ok(error.issues.some((issue) => issue.code === 'curriculum_topic_missing_from_map'))
      return true
    },
  )
})
