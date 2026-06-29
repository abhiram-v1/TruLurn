import assert from 'node:assert/strict'
import test from 'node:test'
import {
  compareCurriculumCandidates,
  curriculumCohortBucket,
  curriculumQualityScore,
  resolveCurriculumRolloutSelection,
} from './curriculumRollout.ts'

const healthy = {
  healthy: true,
  samples: 50,
  repairRate: 0.08,
  failureRate: 0.01,
  averageQuality: 96,
  reasons: [],
}

const unhealthy = {
  healthy: false,
  samples: 50,
  repairRate: 0.3,
  failureRate: 0.02,
  averageQuality: 88,
  reasons: ['repair rate high'],
}

const base = {
  seed: 'stable',
  userId: 'user-1',
  requestKey: 'gradient-descent',
}

test('cohort assignment is stable', () => {
  assert.equal(curriculumCohortBucket(base), curriculumCohortBucket(base))
})

test('legacy and v2 modes choose their expected versions', () => {
  assert.equal(resolveCurriculumRolloutSelection({
    ...base,
    mode: 'legacy',
    rolloutPercent: 100,
    health: healthy,
  }).selectedVersion, 'curriculum-legacy-v1')

  assert.equal(resolveCurriculumRolloutSelection({
    ...base,
    mode: 'v2',
    rolloutPercent: 0,
    health: healthy,
  }).selectedVersion, 'curriculum-v2')
})

test('unhealthy v2 automatically rolls back to legacy', () => {
  const selection = resolveCurriculumRolloutSelection({
    ...base,
    mode: 'v2',
    rolloutPercent: 0,
    health: unhealthy,
  })
  assert.equal(selection.selectedVersion, 'curriculum-legacy-v1')
})

test('canary percentage and health both gate v2 selection', () => {
  assert.equal(resolveCurriculumRolloutSelection({
    ...base,
    mode: 'canary',
    rolloutPercent: 100,
    health: healthy,
  }).selectedVersion, 'curriculum-v2')
  assert.equal(resolveCurriculumRolloutSelection({
    ...base,
    mode: 'canary',
    rolloutPercent: 100,
    health: unhealthy,
  }).selectedVersion, 'curriculum-legacy-v1')
})

test('shadow double generation requires both sampling and explicit enablement', () => {
  assert.equal(resolveCurriculumRolloutSelection({
    ...base,
    mode: 'shadow',
    rolloutPercent: 100,
    health: healthy,
    shadowExecutionEnabled: false,
  }).collectShadow, false)
  const enabled = resolveCurriculumRolloutSelection({
    ...base,
    mode: 'shadow',
    rolloutPercent: 100,
    health: healthy,
    shadowExecutionEnabled: true,
  })
  assert.equal(enabled.selectedVersion, 'curriculum-legacy-v1')
  assert.equal(enabled.shadowVersion, 'curriculum-v2')
})

test('quality scoring penalizes unresolved source defects', () => {
  const clean = {
    title: 'Transactions',
    structure_reasoning: 'Source structure',
    branches: [{ sections: [{ topics: [{ id: 'atomicity' }] }] }],
    source_validation_report: { issues: [] },
  }
  const damaged = {
    ...clean,
    source_validation_report: {
      issues: [{ code: 'invalid_source_ref' }, { code: 'out_of_scope_promoted' }],
    },
  }
  assert.equal(curriculumQualityScore(clean, 'source_grounded'), 100)
  assert.ok(curriculumQualityScore(damaged, 'source_grounded') < 100)
})

test('candidate comparison reports topic overlap and structural deltas', () => {
  const primary = {
    branches: [{ sections: [{ topics: [{ id: 'a', children: [] }, { id: 'b', children: [] }] }] }],
  }
  const shadow = {
    branches: [{ sections: [{ topics: [{ id: 'a', children: [] }, { id: 'c', children: [] }] }] }],
  }
  const comparison = compareCurriculumCandidates(primary, shadow)
  assert.equal(comparison.primary_topic_count, 2)
  assert.equal(comparison.shadow_topic_count, 2)
  assert.equal(comparison.topic_id_overlap, 0.5)
})
