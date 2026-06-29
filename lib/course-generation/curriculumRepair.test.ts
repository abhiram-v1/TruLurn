import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSourceCurriculumRepairPrompt,
  selectCurriculumRepairEvidence,
  shouldAttemptSourceCurriculumModelRepair,
} from './curriculumRepair.ts'
import type { CompactCurriculumSource } from './sourceCompaction.ts'
import type { SourceCurriculumValidationReport } from './sourceCurriculumIntegrity.ts'

const compact: CompactCurriculumSource = {
  schema_version: 'curriculum-source-v1',
  source_fingerprint: 'test',
  compaction_version: 'v1.1',
  original_char_count: 200,
  compact_char_count: 160,
  sources: [{
    source_id: 'doc-1',
    title: 'Transactions',
    headings: ['Atomicity', 'Isolation'],
    sections: [
      {
        source_id: 'doc-1',
        id: 's1:1',
        heading_path: ['Atomicity'],
        ordinal: 0,
        opening_excerpt: 'Atomicity gives all-or-nothing execution.',
        key_definitions: [],
        enumerations: [],
        learning_objectives: [],
        code_samples: [],
        table_summaries: [],
        original_char_count: 80,
      },
      {
        source_id: 'doc-1',
        id: 's1:2',
        heading_path: ['Isolation'],
        ordinal: 1,
        opening_excerpt: 'Isolation controls concurrent visibility.',
        key_definitions: [],
        enumerations: [],
        learning_objectives: [],
        code_samples: [],
        table_summaries: [],
        original_char_count: 80,
      },
    ],
  }],
  coverage_report: {
    source_count: 1,
    represented_source_count: 1,
    heading_count: 2,
    represented_heading_count: 2,
    omitted_sections: [],
    valid: true,
    budget_chars: 0,
    within_budget: true,
    trimmed_section_count: 0,
  },
}

function report(
  issues: SourceCurriculumValidationReport['issues'],
): SourceCurriculumValidationReport {
  return {
    valid: issues.length === 0,
    issues,
    metrics: {
      sourceCount: 1,
      sourceCharacters: 200,
      rootTopicCount: 1,
      totalTopicCount: 1,
      leafTopicCount: 1,
      rootTopicLimit: 3,
      totalTopicLimit: 12,
    },
  }
}

const candidate = {
  branches: [{
    sections: [{
      topics: [{
        id: 'atomicity',
        title: 'Atomicity',
        source_refs: ['s1:1'],
        children: [],
      }],
    }],
  }],
}

test('model repair is reserved for substantive source-fidelity failures', () => {
  assert.equal(shouldAttemptSourceCurriculumModelRepair(report([
    { code: 'duplicate_topic_id', message: 'duplicate' },
  ])), false)
  assert.equal(shouldAttemptSourceCurriculumModelRepair(report([
    { code: 'invalid_source_ref', message: 'bad ref', topicId: 'atomicity' },
  ])), true)
})

test('topic-specific semantic repair sends only cited evidence', () => {
  const evidence = selectCurriculumRepairEvidence(compact, candidate, [{
    code: 'topic_not_supported_by_source',
    message: 'unsupported',
    topicId: 'atomicity',
  }])
  assert.match(evidence, /\[s1:1\]/)
  assert.doesNotMatch(evidence, /\[s1:2\]/)
})

test('missing citations and structural failures receive the bounded full evidence set', () => {
  const evidence = selectCurriculumRepairEvidence(compact, candidate, [{
    code: 'missing_source_refs',
    message: 'missing',
    topicId: 'atomicity',
  }])
  assert.match(evidence, /\[s1:1\]/)
  assert.match(evidence, /\[s1:2\]/)
})

test('repair prompt requests a complete replacement without allowing invented evidence', () => {
  const prompt = buildSourceCurriculumRepairPrompt({
    candidate,
    report: report([{
      code: 'invalid_source_ref',
      message: 'bad ref',
      topicId: 'atomicity',
    }]),
    compactSource: compact,
  })
  assert.match(prompt.system, /complete replacement curriculum/i)
  assert.match(prompt.user, /Remove an unsupported topic/)
  assert.match(prompt.user, /Use only section IDs visible/)
  assert.match(prompt.user, /Candidate curriculum/)
})
