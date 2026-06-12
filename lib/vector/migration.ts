import type { Db } from 'mongodb'
import { ACTIVE_EMBEDDING_VERSION } from '@/lib/ai/embeddings'
import { embedSourcePassageById } from '@/lib/sources/ingestion'
import {
  embedDoubtMessageById,
  embedPageById,
  embedSourceChunkById,
} from '@/lib/vector/retrieval'

const MIGRATION_COLLECTIONS = [
  { collection: 'pages', embed: embedPageById, filter: {} },
  {
    collection: 'doubtMessages',
    embed: embedDoubtMessageById,
    filter: { role: 'user' },
  },
  { collection: 'sourceChunks', embed: embedSourceChunkById, filter: {} },
  { collection: 'sourcePassages', embed: embedSourcePassageById, filter: {} },
] as const

export type HistoricalMigrationStatus = {
  embeddingVersion: string
  completed: boolean
  total: number
  ready: number
  pending: number
  failed: number
  collections: Array<{
    collection: string
    total: number
    ready: number
    pending: number
    failed: number
  }>
  job: Record<string, unknown> | null
}

function jobId(userId: string) {
  return `${userId}:${ACTIVE_EMBEDDING_VERSION}`
}

export async function getHistoricalMigrationStatus(
  db: Db,
  userId: string,
): Promise<HistoricalMigrationStatus> {
  const collections = await Promise.all(MIGRATION_COLLECTIONS.map(async (definition) => {
    const filter = { user_id: userId, ...definition.filter }
    const [total, ready, failed] = await Promise.all([
      db.collection(definition.collection).countDocuments(filter),
      db.collection(definition.collection).countDocuments({
        ...filter,
        embedding_version: ACTIVE_EMBEDDING_VERSION,
        embedding_status: 'ready',
      }),
      db.collection(definition.collection).countDocuments({
        ...filter,
        migration_failed_version: ACTIVE_EMBEDDING_VERSION,
      }),
    ])
    return {
      collection: definition.collection,
      total,
      ready,
      failed,
      pending: Math.max(0, total - ready - failed),
    }
  }))
  const job = await db.collection('ragMigrationJobs').findOne({ _id: jobId(userId) as any })
  const totals = collections.reduce(
    (result, collection) => ({
      total: result.total + collection.total,
      ready: result.ready + collection.ready,
      pending: result.pending + collection.pending,
      failed: result.failed + collection.failed,
    }),
    { total: 0, ready: 0, pending: 0, failed: 0 },
  )

  return {
    embeddingVersion: ACTIVE_EMBEDDING_VERSION,
    completed: totals.pending === 0 && totals.failed === 0,
    ...totals,
    collections,
    job: job ? {
      status: job.status,
      processed: job.processed ?? 0,
      succeeded: job.succeeded ?? 0,
      failed: job.failed ?? 0,
      batches: job.batches ?? 0,
      startedAt: job.started_at ?? null,
      completedAt: job.completed_at ?? null,
      updatedAt: job.updated_at ?? null,
      lastError: job.last_error ?? null,
    } : null,
  }
}

export async function retryFailedHistoricalEmbeddings(db: Db, userId: string) {
  await Promise.all(MIGRATION_COLLECTIONS.map((definition) =>
    db.collection(definition.collection).updateMany(
      {
        user_id: userId,
        ...definition.filter,
        migration_failed_version: ACTIVE_EMBEDDING_VERSION,
      },
      {
        $unset: {
          migration_failed_version: '',
          migration_failed_at: '',
        },
      },
    )))
}

export async function processHistoricalMigrationBatch(
  db: Db,
  userId: string,
  batchSize = 25,
) {
  const size = Math.max(1, Math.min(100, Math.floor(batchSize)))
  const id = jobId(userId)
  const now = new Date()
  await db.collection('ragMigrationJobs').updateOne(
    { _id: id as any },
    {
      $setOnInsert: {
        user_id: userId,
        embedding_version: ACTIVE_EMBEDDING_VERSION,
        status: 'queued',
        processed: 0,
        succeeded: 0,
        failed: 0,
        batches: 0,
        lease_expires_at: null,
        started_at: now,
        created_at: now,
        updated_at: now,
      },
    },
    { upsert: true },
  )
  const lease = await db.collection('ragMigrationJobs').findOneAndUpdate(
    {
      _id: id as any,
      $or: [
        { lease_expires_at: { $exists: false } },
        { lease_expires_at: null },
        { lease_expires_at: { $lte: now } },
      ],
    },
    {
      $set: {
        status: 'running',
        lease_expires_at: new Date(now.getTime() + 5 * 60 * 1000),
        updated_at: now,
      },
    },
    { returnDocument: 'after' },
  )

  if (!lease.value) {
    throw new Error('A historical embedding migration batch is already running.')
  }

  let remaining = size
  let processed = 0
  let succeeded = 0
  let failed = 0
  let lastError: string | null = null

  try {
    for (const definition of MIGRATION_COLLECTIONS) {
      if (remaining <= 0) break
      const documents = await db.collection(definition.collection)
        .find({
          user_id: userId,
          ...definition.filter,
          $or: [
            { embedding_version: { $ne: ACTIVE_EMBEDDING_VERSION } },
            { embedding_status: { $ne: 'ready' } },
          ],
          migration_failed_version: { $ne: ACTIVE_EMBEDDING_VERSION },
        })
        .sort({ embedding_updated_at: 1, created_at: 1, _id: 1 })
        .project({ _id: 1 })
        .limit(remaining)
        .toArray()

      for (const document of documents) {
        processed += 1
        remaining -= 1
        try {
          const ready = await definition.embed(db, String(document._id))
          if (!ready) throw new Error('Embedding did not reach ready state.')
          succeeded += 1
        } catch (error) {
          failed += 1
          lastError = error instanceof Error ? error.message : String(error)
          await db.collection(definition.collection).updateOne(
            { _id: document._id },
            {
              $set: {
                migration_failed_version: ACTIVE_EMBEDDING_VERSION,
                migration_failed_at: new Date(),
              },
            },
          )
        }
      }
    }

    const status = await getHistoricalMigrationStatus(db, userId)
    await db.collection('ragMigrationJobs').updateOne(
      { _id: id as any },
      {
        $set: {
          status: status.completed ? 'completed' : status.failed > 0 ? 'blocked' : 'queued',
          lease_expires_at: null,
          completed_at: status.completed ? new Date() : null,
          last_error: lastError,
          updated_at: new Date(),
        },
        $inc: {
          processed,
          succeeded,
          failed,
          batches: 1,
        },
      },
    )
    return {
      batch: { processed, succeeded, failed },
      status: await getHistoricalMigrationStatus(db, userId),
    }
  } catch (error) {
    await db.collection('ragMigrationJobs').updateOne(
      { _id: id as any },
      {
        $set: {
          status: 'failed',
          lease_expires_at: null,
          last_error: error instanceof Error ? error.message : String(error),
          updated_at: new Date(),
        },
      },
    )
    throw error
  }
}
