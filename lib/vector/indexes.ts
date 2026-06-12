import type { Db } from 'mongodb'
import { ACTIVE_EMBEDDING_DIMENSIONS } from '@/lib/ai/embeddings'

export const VECTOR_INDEX_NAMES = {
  pages: `pages_vector_index_v2_${ACTIVE_EMBEDDING_DIMENSIONS}`,
  doubtMessages: `doubt_messages_vector_index_v2_${ACTIVE_EMBEDDING_DIMENSIONS}`,
  sourceChunks: `source_chunks_vector_index_v2_${ACTIVE_EMBEDDING_DIMENSIONS}`,
  sourcePassages: `source_passages_vector_index_v2_${ACTIVE_EMBEDDING_DIMENSIONS}`,
} as const

export const LEXICAL_INDEX_NAMES = {
  pages: 'pages_lexical_index_v1',
  doubtMessages: 'doubt_messages_lexical_index_v1',
  sourceChunks: 'source_chunks_lexical_index_v1',
  sourcePassages: 'source_passages_lexical_index_v1',
} as const

const VECTOR_INDEXES = [
  {
    collection: 'pages',
    name: VECTOR_INDEX_NAMES.pages,
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
      { type: 'filter', path: 'embedding_version' },
    ],
  },
  {
    collection: 'doubtMessages',
    name: VECTOR_INDEX_NAMES.doubtMessages,
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
      { type: 'filter', path: 'role' },
      { type: 'filter', path: 'embedding_version' },
    ],
  },
  {
    collection: 'sourceChunks',
    name: VECTOR_INDEX_NAMES.sourceChunks,
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
      { type: 'filter', path: 'embedding_version' },
    ],
  },
  {
    collection: 'sourcePassages',
    name: VECTOR_INDEX_NAMES.sourcePassages,
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
      { type: 'filter', path: 'source_document_id' },
      { type: 'filter', path: 'source_version_id' },
      { type: 'filter', path: 'embedding_version' },
    ],
  },
]

const LEXICAL_INDEXES = [
  {
    collection: 'pages',
    name: LEXICAL_INDEX_NAMES.pages,
    fields: {
      content: { type: 'string', analyzer: 'lucene.standard' },
      focus: { type: 'string', analyzer: 'lucene.standard' },
      summary: { type: 'string', analyzer: 'lucene.standard' },
      course_id: { type: 'token' },
      user_id: { type: 'token' },
      topic_id: { type: 'token' },
      embedding_version: { type: 'token' },
    },
  },
  {
    collection: 'doubtMessages',
    name: LEXICAL_INDEX_NAMES.doubtMessages,
    fields: {
      content: { type: 'string', analyzer: 'lucene.standard' },
      course_id: { type: 'token' },
      user_id: { type: 'token' },
      topic_id: { type: 'token' },
      role: { type: 'token' },
      embedding_version: { type: 'token' },
    },
  },
  ...(['sourceChunks', 'sourcePassages'] as const).map((collection) => ({
    collection,
    name: LEXICAL_INDEX_NAMES[collection],
    fields: {
      content: { type: 'string', analyzer: 'lucene.standard' },
      source_title: { type: 'string', analyzer: 'lucene.standard' },
      heading_path: { type: 'string', analyzer: 'lucene.standard' },
      course_id: { type: 'token' },
      user_id: { type: 'token' },
      topic_id: { type: 'token' },
      source_document_id: { type: 'token' },
      source_version_id: { type: 'token' },
      embedding_version: { type: 'token' },
    },
  })),
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

export async function ensureLexicalSearchIndexes(db: Db) {
  const results: Array<{
    collection: string
    index: string
    status: 'created' | 'exists' | 'error'
    error?: string
  }> = []

  for (const index of LEXICAL_INDEXES) {
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
            type: 'search',
            definition: {
              mappings: {
                dynamic: false,
                fields: index.fields,
              },
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
