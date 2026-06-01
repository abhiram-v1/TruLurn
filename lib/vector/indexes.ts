import type { Db } from 'mongodb'
import { ACTIVE_EMBEDDING_DIMENSIONS } from '@/lib/ai/embeddings'

const VECTOR_INDEXES = [
  {
    collection: 'pages',
    name: 'pages_vector_index',
    fields: [
      {
        type: 'vector',
        path: 'embedding',
        numDimensions: ACTIVE_EMBEDDING_DIMENSIONS,
        similarity: 'cosine',
      },
      { type: 'filter', path: 'course_id' },
      { type: 'filter', path: 'topic_id' },
      { type: 'filter', path: 'user_id' },
    ],
  },
  {
    collection: 'doubtMessages',
    name: 'doubt_messages_vector_index',
    fields: [
      {
        type: 'vector',
        path: 'embedding',
        numDimensions: ACTIVE_EMBEDDING_DIMENSIONS,
        similarity: 'cosine',
      },
      { type: 'filter', path: 'course_id' },
      { type: 'filter', path: 'user_id' },
      { type: 'filter', path: 'topic_id' },
    ],
  },
  {
    collection: 'sourceChunks',
    name: 'source_chunks_vector_index',
    fields: [
      {
        type: 'vector',
        path: 'embedding',
        numDimensions: ACTIVE_EMBEDDING_DIMENSIONS,
        similarity: 'cosine',
      },
      { type: 'filter', path: 'course_id' },
      { type: 'filter', path: 'topic_id' },
      { type: 'filter', path: 'user_id' },
    ],
  },
]

export async function ensureVectorSearchIndexes(db: Db) {
  const results: Array<{
    collection: string
    index: string
    status: 'created' | 'exists' | 'error'
    error?: string
  }> = []

  for (const index of VECTOR_INDEXES) {
    try {
      const collections = await db.listCollections({ name: index.collection }).toArray()
      if (!collections.length) {
        await db.createCollection(index.collection)
      }

      const collection = db.collection(index.collection)
      const existing = await collection.listSearchIndexes(index.name).toArray()
      if (existing.length) {
        results.push({
          collection: index.collection,
          index: index.name,
          status: 'exists',
        })
        continue
      }

      await db.command({
        createSearchIndexes: index.collection,
        indexes: [
          {
            name: index.name,
            type: 'vectorSearch',
            definition: {
              fields: index.fields,
            },
          },
        ],
      })

      results.push({
        collection: index.collection,
        index: index.name,
        status: 'created',
      })
    } catch (error) {
      results.push({
        collection: index.collection,
        index: index.name,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown index setup error',
      })
    }
  }

  return results
}
