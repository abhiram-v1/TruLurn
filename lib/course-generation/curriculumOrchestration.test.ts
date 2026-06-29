import assert from 'node:assert/strict'
import test from 'node:test'
import {
  finalizeCurriculum,
  hydrateCurriculumDefaults,
} from './curriculumHydration.ts'
import type { CourseGenerationInput } from './input.ts'

function input(mode: CourseGenerationInput['mode']): CourseGenerationInput {
  return {
    topic: 'Transactions',
    goals: 'Learn database transactions.',
    mode,
    learningControl: 'balanced',
    courseDepth: 'standard',
    knowledgeLevel: 'intermediate',
    learningPurpose: 'practitioner',
    teachingPersona: 'immersive_builder',
    previewCurriculum: true,
    sourceLimitations: ['One image could not be read.'],
  }
}

function curriculum() {
  return {
    title: 'Transactions',
    complexity: 'narrow',
    structure_reasoning: 'One cohesive unit.',
    branches: [{
      id: 'transactions',
      title: 'Transactions',
      description: 'Core transaction concepts',
      sections: [{
        title: 'Core',
        topics: [{
          id: 'atomicity',
          title: 'Atomicity',
          description: 'All-or-nothing execution',
          prerequisites: [],
          prerequisite_strength: {},
          depth: 'important',
          estimated_pages: 3,
          node_type: 'learning_unit',
          importance: 'core',
          role: 'mechanism',
          spine_candidate: false,
          spine_level: 0,
          children: [{
            id: 'rollback',
            title: 'Rollback',
            description: 'Undoing partial work',
            prerequisites: ['atomicity'],
            prerequisite_strength: { atomicity: 'hard' },
            depth: 'medium',
            estimated_pages: 2,
            node_type: 'learning_unit',
            importance: 'supporting',
            role: 'mechanism',
            spine_candidate: false,
            spine_level: 0,
            children: [],
          }],
        }],
      }],
    }],
  }
}

test('fixed curriculum fields are hydrated deterministically', () => {
  const candidate = curriculum()
  hydrateCurriculumDefaults(candidate, input('ai_teacher'))

  assert.equal(candidate.branches[0].state, 'not_started')
  assert.equal(candidate.branches[0].sections[0].topics[0].initial_state, 'active')
  assert.equal(candidate.branches[0].sections[0].topics[0].children[0].initial_state, 'locked')
  assert.deepEqual((candidate as any).source_limitations, ['One image could not be read.'])
})

test('source finalization derives anchors from stable refs and hydrates boundaries', () => {
  const candidate = curriculum() as any
  const topic = candidate.branches[0].sections[0].topics[0]
  topic.source_refs = ['s1:1']
  topic.concept_group = 'current'
  topic.children = []
  candidate.source_sequence_policy = 'preserve_uploaded_source_order'

  const sourceInput = {
    ...input('source_grounded'),
    sourceText: 'Source 1: Transactions\nAtomicity means all or nothing.',
    sourceProfile: {
      schema_version: 'source-profile-v2' as const,
      source_fingerprint: 'test',
      metadata: {
        subject_domain: 'Databases',
        educational_level: 'undergraduate',
        document_type: 'chapter',
        scope: { covered_topics: ['Atomicity'], full_subject: 'DBMS', coverage: 'narrow' as const },
        emphasized_concepts: ['Atomicity'],
        implied_prerequisites: ['Basic SQL'],
        curriculum_terminology: ['atomicity'],
        exam_signals: [],
        teaching_progression: 'Atomicity first',
        depth_expectation: 'apply',
        reconstruction: {
          prerequisite_topics: [],
          dependent_topics: ['Recovery algorithms'],
          recommended_course_scope: 'Atomicity',
        },
      },
      style: null,
      style_status: 'pending' as const,
      style_attempts: 0,
      metadata_generated_at: '',
      style_generated_at: null,
      style_error: null,
    },
    compactCurriculumSource: {
      schema_version: 'curriculum-source-v1' as const,
      source_fingerprint: 'test',
      compaction_version: 'v1.1',
      original_char_count: 50,
      compact_char_count: 40,
      sources: [{
        source_id: 'doc-1',
        title: 'Transactions',
        headings: ['Atomicity'],
        sections: [{
          source_id: 'doc-1',
          id: 's1:1',
          heading_path: ['Atomicity'],
          ordinal: 0,
          opening_excerpt: 'Atomicity means all or nothing.',
          key_definitions: [],
          enumerations: [],
          learning_objectives: [],
          code_samples: [],
          table_summaries: [],
          original_char_count: 40,
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
    },
  }

  const finalized = finalizeCurriculum(candidate, sourceInput)
  assert.equal(topic.source_coverage, 'covered')
  assert.equal(topic.source_anchor, 'Source 1 — Atomicity')
  assert.deepEqual(finalized.out_of_scope.assumed_prerequisites, ['Basic SQL'])
  assert.deepEqual(finalized.out_of_scope.mentioned_followups, ['Recovery algorithms'])
})

test('legacy source anchors survive finalization when compact evidence is unavailable', () => {
  const candidate = curriculum() as any
  const topic = candidate.branches[0].sections[0].topics[0]
  topic.source_anchor = 'Source 1 — Atomicity'
  topic.source_coverage = 'covered'
  topic.concept_group = 'current'
  topic.children = []
  candidate.source_sequence_policy = 'preserve_uploaded_source_order'

  const finalized = finalizeCurriculum(candidate, {
    ...input('source_grounded'),
    sourceText: 'Source 1: Transactions\nAtomicity means all or nothing.',
  })

  assert.equal(finalized.branches[0].sections[0].topics[0].source_anchor, 'Source 1 — Atomicity')
})
