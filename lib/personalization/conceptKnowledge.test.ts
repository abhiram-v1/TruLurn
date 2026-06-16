import assert from 'node:assert/strict'
import test from 'node:test'

import {
  conceptTeachingGuidance,
  deriveConceptKnowledgeEstimate,
  type ConceptEvidence,
} from './conceptKnowledge.ts'

const now = new Date('2026-06-14T00:00:00.000Z')

function evidence(
  id: string,
  kind: ConceptEvidence['kind'],
  daysAgo: number,
  successful: boolean | null = null,
  weight = 1,
): ConceptEvidence {
  return {
    id,
    kind,
    successful,
    weight,
    observed_at: new Date(now.getTime() - daysAgo * 86_400_000),
  }
}

test('weak exposure signals establish recognition but not understanding', () => {
  const estimate = deriveConceptKnowledgeEstimate([
    evidence('page-1', 'lesson_view', 2, null, 0.25),
    evidence('chat-1', 'chat_discussion', 1, null, 0.2),
    evidence('feedback-1', 'lesson_feedback', 1, true, 0.2),
  ], now)

  assert.equal(estimate.stage, 'recognizes')
  assert.equal(estimate.source, 'observed')
  assert.match(conceptTeachingGuidance('Gradient descent', estimate), /not demonstrated understanding/)
})

test('repeated explanation evidence establishes understanding', () => {
  const estimate = deriveConceptKnowledgeEstimate([
    evidence('explain-1', 'assessment_explain', 4, true, 1),
    evidence('explain-2', 'assessment_explain', 1, true, 1),
  ], now)

  assert.equal(estimate.stage, 'understands')
  assert.equal(estimate.source, 'validated_assessment')
})

test('application evidence does not become transfer without hard cross-context evidence', () => {
  const applied = deriveConceptKnowledgeEstimate([
    evidence('apply-1', 'assessment_apply', 5, true, 1),
    evidence('apply-2', 'assessment_apply', 2, true, 1),
  ], now)
  const transferred = deriveConceptKnowledgeEstimate([
    evidence('apply-1', 'assessment_apply', 8, true, 1),
    evidence('transfer-1', 'assessment_transfer', 5, true, 1.1),
    evidence('transfer-2', 'assessment_transfer', 1, true, 1.1),
  ], now)

  assert.equal(applied.stage, 'applies')
  assert.equal(transferred.stage, 'transfers')
})

test('the same concept produces different teaching guidance from contrasting histories', () => {
  const familiarOnly = deriveConceptKnowledgeEstimate([
    evidence('page-1', 'lesson_view', 1, null, 0.25),
  ], now)
  const canApply = deriveConceptKnowledgeEstimate([
    evidence('apply-1', 'assessment_apply', 3, true, 1),
    evidence('apply-2', 'assessment_apply', 1, true, 1),
  ], now)

  const firstGuidance = conceptTeachingGuidance('Bayes theorem', familiarOnly)
  const secondGuidance = conceptTeachingGuidance('Bayes theorem', canApply)
  assert.match(firstGuidance, /not demonstrated understanding/)
  assert.match(secondGuidance, /Build on it without reteaching basics/)
  assert.notEqual(firstGuidance, secondGuidance)
})

test('old assessed knowledge becomes forgetting even after unassessed exposure', () => {
  const estimate = deriveConceptKnowledgeEstimate([
    evidence('explain-1', 'assessment_explain', 90, true, 1),
    evidence('explain-2', 'assessment_explain', 80, true, 1),
    evidence('recent-view', 'lesson_view', 1, null, 0.25),
  ], now)

  assert.equal(estimate.stage, 'forgetting')
  assert.equal(estimate.freshness, 'stale')
})
