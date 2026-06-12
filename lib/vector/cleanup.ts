import crypto from 'crypto'
import type { Db } from 'mongodb'
import { auditUserDeletionLineage } from '@/lib/sources/deletion'
import {
  allWorkflowsOnV2,
  getRetrievalCutoverConfig,
  getRetrievalParityReport,
} from '@/lib/vector/cutover'
import { getHistoricalMigrationStatus } from '@/lib/vector/migration'
import { LEXICAL_INDEX_NAMES, VECTOR_INDEX_NAMES } from '@/lib/vector/indexes'

const INDEXES = [
  ['pages', VECTOR_INDEX_NAMES.pages],
  ['doubtMessages', VECTOR_INDEX_NAMES.doubtMessages],
  ['sourceChunks', VECTOR_INDEX_NAMES.sourceChunks],
  ['sourcePassages', VECTOR_INDEX_NAMES.sourcePassages],
  ['pages', LEXICAL_INDEX_NAMES.pages],
  ['doubtMessages', LEXICAL_INDEX_NAMES.doubtMessages],
  ['sourceChunks', LEXICAL_INDEX_NAMES.sourceChunks],
  ['sourcePassages', LEXICAL_INDEX_NAMES.sourcePassages],
] as const

async function indexReadiness(db: Db) {
  const indexes = await Promise.all(INDEXES.map(async ([collection, index]) => {
    const matches = await db.collection(collection)
      .listSearchIndexes(index)
      .toArray()
      .catch(() => [])
    const ready = (matches as Array<Record<string, unknown>>).some((entry) =>
      entry.queryable === true || String(entry.status ?? '').toUpperCase() === 'READY')
    return { collection, index, ready }
  }))
  return {
    ready: indexes.every((index) => index.ready),
    indexes,
  }
}

export async function getLegacyCleanupGate(db: Db, userId: string) {
  const [config, migration, parity, deletion, indexes] = await Promise.all([
    getRetrievalCutoverConfig(db, userId),
    getHistoricalMigrationStatus(db, userId),
    getRetrievalParityReport(db, userId),
    auditUserDeletionLineage(db, userId),
    indexReadiness(db),
  ])
  const parityRows = Object.values(parity) as Array<{
    samples: number
    averageOverlap: number | null
  }>
  const paritySamples = parityRows.reduce((sum, row) => sum + row.samples, 0)
  const weightedOverlap = paritySamples
    ? parityRows.reduce(
        (sum, row) => sum + (row.averageOverlap ?? 0) * row.samples,
        0,
      ) / paritySamples
    : null
  const minimumSamples = Math.max(1, Number(process.env.RAG_CLEANUP_MIN_PARITY_SAMPLES ?? 10))
  const minimumOverlap = Math.max(
    0,
    Math.min(1, Number(process.env.RAG_CLEANUP_MIN_OVERLAP ?? 0.35)),
  )
  const checks = {
    allWorkflowsV2: allWorkflowsOnV2(config),
    migrationComplete: migration.completed,
    indexesReady: indexes.ready,
    parityPassed: paritySamples >= minimumSamples
      && weightedOverlap !== null
      && weightedOverlap >= minimumOverlap,
    deletionLineagePassed: deletion.passed,
  }

  return {
    ready: Object.values(checks).every(Boolean),
    checks,
    thresholds: { minimumSamples, minimumOverlap },
    parity: { samples: paritySamples, weightedOverlap, workflows: parity },
    migration,
    indexes,
    deletion,
    config,
  }
}

export async function retireLegacyVectorFields(db: Db, userId: string) {
  const gate = await getLegacyCleanupGate(db, userId)
  if (!gate.ready) {
    throw new Error('Legacy cleanup is blocked until every Phase 5 gate passes.')
  }

  const legacyUnset = {
    embedding_v1: '',
    legacy_embedding: '',
    legacy_embedding_provider: '',
    legacy_embedding_model: '',
    legacy_embedding_dimensions: '',
    legacy_embedding_version: '',
  }
  const collections = ['pages', 'doubtMessages', 'sourceChunks', 'sourcePassages']
  const cleaned = Object.fromEntries(await Promise.all(collections.map(async (collection) => {
    const result = await db.collection(collection).updateMany(
      { user_id: userId },
      { $unset: legacyUnset },
    )
    return [collection, result.modifiedCount]
  })))
  const excludedAssistantMessages = await db.collection('doubtMessages').updateMany(
    { user_id: userId, role: 'assistant' },
    {
      $set: {
        retrieval_eligible: false,
        embedding_status: 'excluded',
      },
      $unset: {
        embedding: '',
        embedding_provider: '',
        embedding_model: '',
        embedding_dimensions: '',
        embedding_version: '',
        embedding_updated_at: '',
      },
    },
  )

  const run = {
    _id: crypto.randomUUID() as any,
    user_id: userId,
    cleanup_version: 'rag-v2-cutover-v1',
    embedding_version: gate.migration.embeddingVersion,
    cleaned,
    excluded_assistant_messages: excludedAssistantMessages.modifiedCount,
    gate_snapshot: gate,
    created_at: new Date(),
  }
  await db.collection('ragCleanupRuns').insertOne(run)

  return {
    cleaned,
    excludedAssistantMessages: excludedAssistantMessages.modifiedCount,
    cleanupRunId: String(run._id),
  }
}
