import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { ACTIVE_EMBEDDING_VERSION } from '@/lib/ai/embeddings'
import { LEXICAL_INDEX_NAMES, VECTOR_INDEX_NAMES } from '@/lib/vector/indexes'
import { getRetrievalCutoverConfig, getRetrievalParityReport } from '@/lib/vector/cutover'
import { getHistoricalMigrationStatus } from '@/lib/vector/migration'

const VECTOR_COLLECTIONS = [
  { collection: 'pages', index: VECTOR_INDEX_NAMES.pages },
  { collection: 'doubtMessages', index: VECTOR_INDEX_NAMES.doubtMessages, extraFilter: { role: 'user' } },
  { collection: 'sourceChunks', index: VECTOR_INDEX_NAMES.sourceChunks },
  { collection: 'sourcePassages', index: VECTOR_INDEX_NAMES.sourcePassages },
] as const

const LEXICAL_COLLECTIONS = [
  { collection: 'pages', index: LEXICAL_INDEX_NAMES.pages },
  { collection: 'doubtMessages', index: LEXICAL_INDEX_NAMES.doubtMessages },
  { collection: 'sourceChunks', index: LEXICAL_INDEX_NAMES.sourceChunks },
  { collection: 'sourcePassages', index: LEXICAL_INDEX_NAMES.sourcePassages },
] as const

export async function GET() {
  try {
    const db = await getDb()
    const userId = await getRequiredUserId()
    const courses = await db.collection('courses')
      .find({ user_id: userId })
      .project({ _id: 1 })
      .toArray()
    const courseIds = courses.map((course) => String(course._id))

    const collections = await Promise.all(
      VECTOR_COLLECTIONS.map(async ({ collection, index, ...configuration }) => {
        const mongoCollection = db.collection(collection)
        const extraFilter = 'extraFilter' in configuration ? configuration.extraFilter : {}
        const [indexes, total, embedded] = await Promise.all([
          mongoCollection.listSearchIndexes(index).toArray().catch(() => []),
          courseIds.length
            ? mongoCollection.countDocuments({ course_id: { $in: courseIds }, ...extraFilter })
            : Promise.resolve(0),
          courseIds.length
            ? mongoCollection.countDocuments({
                course_id: { $in: courseIds },
                ...extraFilter,
                embedding_version: ACTIVE_EMBEDDING_VERSION,
                embedding_status: 'ready',
              })
            : Promise.resolve(0),
        ])

        return {
          collection,
          index,
          indexReady: indexes.length > 0,
          total,
          embedded,
          missingEmbeddings: Math.max(0, total - embedded),
        }
      }),
    )
    const lexicalIndexes = await Promise.all(
      LEXICAL_COLLECTIONS.map(async ({ collection, index }) => {
        const indexes = await db.collection(collection)
          .listSearchIndexes(index)
          .toArray()
          .catch(() => [])
        return {
          collection,
          index,
          indexReady: (indexes as Array<Record<string, unknown>>).some((entry) =>
            entry.queryable === true || String(entry.status ?? '').toUpperCase() === 'READY'),
        }
      }),
    )

    const [cutover, migration, parity] = await Promise.all([
      getRetrievalCutoverConfig(db, userId),
      getHistoricalMigrationStatus(db, userId),
      getRetrievalParityReport(db, userId),
    ])

    return NextResponse.json({
      ok: true,
      courseCount: courseIds.length,
      embeddingVersion: ACTIVE_EMBEDDING_VERSION,
      collections,
      lexicalIndexes,
      cutover,
      migration,
      parity,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown vector status error'
    const status = message.includes('sign in') ? 401 : 500

    return NextResponse.json({ error: message }, { status })
  }
}
