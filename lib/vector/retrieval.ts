import type { Db } from 'mongodb'
import { ACTIVE_EMBEDDING_MODEL, embedText } from '@/lib/ai/embeddings'

export type RelevantPage = {
  id: string
  topic_id: string
  topic_title: string
  page_number: number
  focus: string | null
  summary: string | null
  content: string
  score: number | null
}

export type RelevantDoubtMemory = {
  id: string
  topic_id: string
  topic_title: string | null
  page_number: number | null
  role: 'user' | 'assistant'
  content: string
  score: number | null
}

export type RelevantSourceChunk = {
  id: string
  topic_id: string | null
  source_title: string | null
  content: string
  score: number | null
}

export type CourseMemoryContext = {
  pages: RelevantPage[]
  doubtMessages: RelevantDoubtMemory[]
  sourceChunks: RelevantSourceChunk[]
}

function queryFilter(courseId: string, userId?: string) {
  return userId ? { course_id: courseId, user_id: userId } : { course_id: courseId }
}

function pageEmbeddingText(page: any, topic?: any, summary?: any) {
  return [
    `Topic: ${topic?.title ?? page.topic_title ?? page.topic_id}`,
    summary?.focus ? `Focus: ${summary.focus}` : null,
    summary?.summary ? `Summary: ${summary.summary}` : null,
    Array.isArray(summary?.key_concepts) && summary.key_concepts.length
      ? `Key concepts: ${summary.key_concepts.join(', ')}`
      : null,
    `Content: ${page.content}`,
  ]
    .filter(Boolean)
    .join('\n')
}

function doubtEmbeddingText(message: any) {
  return [
    `Role: ${message.role}`,
    message.topic_title ? `Topic: ${message.topic_title}` : null,
    message.page_number ? `Page: ${message.page_number}` : null,
    message.content,
  ]
    .filter(Boolean)
    .join('\n')
}

function sourceChunkEmbeddingText(chunk: any) {
  return [
    chunk.source_title ? `Source: ${chunk.source_title}` : null,
    chunk.topic_title ? `Topic: ${chunk.topic_title}` : null,
    chunk.summary ? `Summary: ${chunk.summary}` : null,
    chunk.content ?? chunk.text ?? chunk.chunk_text,
  ]
    .filter(Boolean)
    .join('\n')
}

export async function embedPageById(db: Db, pageId: string) {
  const page = await db.collection('pages').findOne({ _id: pageId as any })
  if (!page) return false

  const [topic, summary] = await Promise.all([
    db.collection('topics').findOne({ _id: page.topic_id as any, course_id: page.course_id }),
    db.collection('pageSummaries').findOne({ page_id: String(page._id), course_id: page.course_id }),
  ])

  const embedding = await embedText(pageEmbeddingText(page, topic, summary), 'RETRIEVAL_DOCUMENT')

  await db.collection('pages').updateOne(
    { _id: page._id },
    {
      $set: {
        embedding,
        embedding_model: ACTIVE_EMBEDDING_MODEL,
        embedding_updated_at: new Date(),
      },
    },
  )

  return true
}

export async function embedSourceChunkById(db: Db, chunkId: string) {
  const chunk = await db.collection('sourceChunks').findOne({ _id: chunkId as any })
  if (!chunk) return false

  const text = sourceChunkEmbeddingText(chunk)
  if (!text.trim()) return false

  const embedding = await embedText(text, 'RETRIEVAL_DOCUMENT')

  await db.collection('sourceChunks').updateOne(
    { _id: chunk._id },
    {
      $set: {
        embedding,
        embedding_model: ACTIVE_EMBEDDING_MODEL,
        embedding_updated_at: new Date(),
      },
    },
  )

  return true
}

export async function embedDoubtMessageById(db: Db, messageId: string) {
  const message = await db.collection('doubtMessages').findOne({ _id: messageId as any })
  if (!message) return false

  const topic = await db.collection('topics').findOne({
    _id: message.topic_id as any,
    course_id: message.course_id,
  })

  const embedding = await embedText(
    doubtEmbeddingText({ ...message, topic_title: topic?.title }),
    message.role === 'user' ? 'QUESTION_ANSWERING' : 'RETRIEVAL_DOCUMENT',
  )

  await db.collection('doubtMessages').updateOne(
    { _id: message._id },
    {
      $set: {
        embedding,
        embedding_model: ACTIVE_EMBEDDING_MODEL,
        embedding_updated_at: new Date(),
      },
    },
  )

  return true
}

async function fallbackRelevantPages(
  db: Db,
  courseId: string,
  excludeTopicId: string,
  limit: number,
  userId?: string,
): Promise<RelevantPage[]> {
  const pages = await db.collection('pages')
    .find({
      ...queryFilter(courseId, userId),
      topic_id: { $ne: excludeTopicId },
    })
    .sort({ created_at: -1 })
    .limit(limit)
    .toArray()

  const topicIds = [...new Set(pages.map((page) => String(page.topic_id)))]
  const topics = await db.collection('topics')
    .find({ course_id: courseId, _id: { $in: topicIds as any[] } })
    .project({ title: 1 })
    .toArray()
  const topicTitleById = new Map(topics.map((topic) => [String(topic._id), topic.title]))

  return pages.map((page) => ({
    id: String(page._id),
    topic_id: String(page.topic_id),
    topic_title: topicTitleById.get(String(page.topic_id)) ?? 'Earlier topic',
    page_number: page.page_number,
    focus: page.focus ?? null,
    summary: page.summary ?? null,
    content: page.content,
    score: null,
  }))
}

export async function findRelevantPages({
  db,
  query,
  queryVector: precomputedVector,
  courseId,
  userId,
  excludeTopicId,
  limit = 2,
}: {
  db: Db
  query: string
  queryVector?: number[]
  courseId: string
  userId?: string
  excludeTopicId: string
  limit?: number
}): Promise<RelevantPage[]> {
  try {
    const queryVector = precomputedVector ?? await embedText(query, 'QUESTION_ANSWERING')
    const results = await db.collection('pages')
      .aggregate([
        {
          $vectorSearch: {
            index: 'pages_vector_index',
            path: 'embedding',
            queryVector,
            numCandidates: Math.max(50, limit * 20),
            limit: limit + 4,
            filter: queryFilter(courseId, userId),
          },
        },
        {
          $match: {
            topic_id: { $ne: excludeTopicId },
          },
        },
        {
          $lookup: {
            from: 'topics',
            localField: 'topic_id',
            foreignField: '_id',
            as: 'topic',
          },
        },
        {
          $project: {
            _id: 1,
            topic_id: 1,
            page_number: 1,
            focus: 1,
            summary: 1,
            content: 1,
            topic_title: { $first: '$topic.title' },
            score: { $meta: 'vectorSearchScore' },
          },
        },
        { $limit: limit },
      ])
      .toArray()

    if (!results.length) {
      return fallbackRelevantPages(db, courseId, excludeTopicId, limit, userId)
    }

    return results.map((page) => ({
      id: String(page._id),
      topic_id: String(page.topic_id),
      topic_title: page.topic_title ?? 'Earlier topic',
      page_number: page.page_number,
      focus: page.focus ?? null,
      summary: page.summary ?? null,
      content: page.content,
      score: typeof page.score === 'number' ? page.score : null,
    }))
  } catch (error) {
    console.warn('Vector page retrieval failed, falling back to recent pages.', error)
    return fallbackRelevantPages(db, courseId, excludeTopicId, limit, userId)
  }
}

async function fallbackRelevantDoubtMessages(
  db: Db,
  courseId: string,
  userId: string,
  excludeTopicId: string | undefined,
  limit: number,
): Promise<RelevantDoubtMemory[]> {
  const filter: Record<string, unknown> = { course_id: courseId, user_id: userId }
  if (excludeTopicId) filter.topic_id = { $ne: excludeTopicId }

  const messages = await db.collection('doubtMessages')
    .find(filter)
    .sort({ created_at: -1 })
    .limit(limit)
    .toArray()

  const topicIds = [...new Set(messages.map((message) => String(message.topic_id)).filter(Boolean))]
  const topics = await db.collection('topics')
    .find({ course_id: courseId, _id: { $in: topicIds as any[] } })
    .project({ title: 1 })
    .toArray()
  const topicTitleById = new Map(topics.map((topic) => [String(topic._id), topic.title]))

  return messages.map((message) => ({
    id: String(message._id),
    topic_id: String(message.topic_id),
    topic_title: topicTitleById.get(String(message.topic_id)) ?? null,
    page_number: typeof message.page_number === 'number' ? message.page_number : null,
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: String(message.content ?? ''),
    score: null,
  }))
}

export async function findRelevantDoubtMessages({
  db,
  query,
  queryVector: precomputedVector,
  courseId,
  userId,
  excludeTopicId,
  limit = 4,
}: {
  db: Db
  query: string
  queryVector?: number[]
  courseId: string
  userId: string
  excludeTopicId?: string
  limit?: number
}): Promise<RelevantDoubtMemory[]> {
  try {
    const queryVector = precomputedVector ?? await embedText(query, 'QUESTION_ANSWERING')
    const match: Record<string, unknown> = {}
    if (excludeTopicId) match.topic_id = { $ne: excludeTopicId }

    const results = await db.collection('doubtMessages')
      .aggregate([
        {
          $vectorSearch: {
            index: 'doubt_messages_vector_index',
            path: 'embedding',
            queryVector,
            numCandidates: Math.max(50, limit * 20),
            limit: limit + 6,
            filter: { course_id: courseId, user_id: userId },
          },
        },
        ...(Object.keys(match).length ? [{ $match: match }] : []),
        {
          $lookup: {
            from: 'topics',
            localField: 'topic_id',
            foreignField: '_id',
            as: 'topic',
          },
        },
        {
          $project: {
            _id: 1,
            topic_id: 1,
            page_number: 1,
            role: 1,
            content: 1,
            topic_title: { $first: '$topic.title' },
            score: { $meta: 'vectorSearchScore' },
          },
        },
        { $limit: limit },
      ])
      .toArray()

    if (!results.length) {
      return fallbackRelevantDoubtMessages(db, courseId, userId, excludeTopicId, limit)
    }

    return results.map((message) => ({
      id: String(message._id),
      topic_id: String(message.topic_id),
      topic_title: message.topic_title ?? null,
      page_number: typeof message.page_number === 'number' ? message.page_number : null,
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: String(message.content ?? ''),
      score: typeof message.score === 'number' ? message.score : null,
    }))
  } catch (error) {
    console.warn('Vector doubt retrieval failed, falling back to recent messages.', error)
    return fallbackRelevantDoubtMessages(db, courseId, userId, excludeTopicId, limit)
  }
}

async function fallbackRelevantSourceChunks(
  db: Db,
  courseId: string,
  userId: string,
  limit: number,
): Promise<RelevantSourceChunk[]> {
  const chunks = await db.collection('sourceChunks')
    .find({ course_id: courseId, user_id: userId })
    .sort({ created_at: -1 })
    .limit(limit)
    .toArray()

  return chunks.map((chunk) => ({
    id: String(chunk._id),
    topic_id: chunk.topic_id ? String(chunk.topic_id) : null,
    source_title: chunk.source_title ?? chunk.title ?? null,
    content: String(chunk.content ?? chunk.text ?? chunk.chunk_text ?? ''),
    score: null,
  }))
}

export async function findRelevantSourceChunks({
  db,
  query,
  queryVector: precomputedVector,
  courseId,
  userId,
  topicId,
  limit = 3,
}: {
  db: Db
  query: string
  queryVector?: number[]
  courseId: string
  userId: string
  topicId?: string
  limit?: number
}): Promise<RelevantSourceChunk[]> {
  try {
    const queryVector = precomputedVector ?? await embedText(query, 'QUESTION_ANSWERING')
    const match: Record<string, unknown> = {}
    if (topicId) {
      match.$or = [{ topic_id: topicId }, { topic_id: { $exists: false } }, { topic_id: null }]
    }

    const results = await db.collection('sourceChunks')
      .aggregate([
        {
          $vectorSearch: {
            index: 'source_chunks_vector_index',
            path: 'embedding',
            queryVector,
            numCandidates: Math.max(50, limit * 20),
            limit: limit + 4,
            filter: { course_id: courseId, user_id: userId },
          },
        },
        ...(Object.keys(match).length ? [{ $match: match }] : []),
        {
          $project: {
            _id: 1,
            topic_id: 1,
            source_title: 1,
            title: 1,
            content: 1,
            text: 1,
            chunk_text: 1,
            score: { $meta: 'vectorSearchScore' },
          },
        },
        { $limit: limit },
      ])
      .toArray()

    if (!results.length) {
      return fallbackRelevantSourceChunks(db, courseId, userId, limit)
    }

    return results.map((chunk) => ({
      id: String(chunk._id),
      topic_id: chunk.topic_id ? String(chunk.topic_id) : null,
      source_title: chunk.source_title ?? chunk.title ?? null,
      content: String(chunk.content ?? chunk.text ?? chunk.chunk_text ?? ''),
      score: typeof chunk.score === 'number' ? chunk.score : null,
    }))
  } catch (error) {
    console.warn('Vector source retrieval failed, falling back to recent source chunks.', error)
    return fallbackRelevantSourceChunks(db, courseId, userId, limit)
  }
}

export async function retrieveCourseMemory({
  db,
  query,
  courseId,
  userId,
  currentTopicId,
  pageLimit = 3,
  doubtLimit = 4,
  sourceLimit = 3,
}: {
  db: Db
  query: string
  courseId: string
  userId: string
  currentTopicId?: string
  pageLimit?: number
  doubtLimit?: number
  sourceLimit?: number
}): Promise<CourseMemoryContext> {
  const needsAny = (currentTopicId && pageLimit > 0) || doubtLimit > 0 || sourceLimit > 0

  // Embed the query ONCE and share the vector across all three sub-functions.
  // Without this, each sub-function independently embeds the same text —
  // three identical embedding API calls per retrieval trigger.
  const sharedVector = needsAny ? await embedText(query, 'QUESTION_ANSWERING') : undefined

  const [pages, doubtMessages, sourceChunks] = await Promise.all([
    currentTopicId && pageLimit > 0 && sharedVector
      ? findRelevantPages({
          db,
          query,
          queryVector: sharedVector,
          courseId,
          userId,
          excludeTopicId: currentTopicId,
          limit: pageLimit,
        })
      : Promise.resolve([]),
    doubtLimit > 0 && sharedVector
      ? findRelevantDoubtMessages({
          db,
          query,
          queryVector: sharedVector,
          courseId,
          userId,
          excludeTopicId: currentTopicId,
          limit: doubtLimit,
        })
      : Promise.resolve([]),
    sourceLimit > 0 && sharedVector
      ? findRelevantSourceChunks({
          db,
          query,
          queryVector: sharedVector,
          courseId,
          userId,
          topicId: currentTopicId,
          limit: sourceLimit,
        })
      : Promise.resolve([]),
  ])

  return { pages, doubtMessages, sourceChunks }
}

export async function backfillUserEmbeddings(db: Db, userId: string) {
  const courses = await db.collection('courses')
    .find({ user_id: userId })
    .project({ _id: 1 })
    .toArray()
  const courseIds = courses.map((course) => String(course._id))

  if (!courseIds.length) {
    return { pages: 0, doubtMessages: 0 }
  }

  const pages = await db.collection('pages')
    .find({
      course_id: { $in: courseIds },
      embedding: { $exists: false },
    })
    .project({ _id: 1 })
    .limit(200)
    .toArray()

  let embeddedPages = 0
  for (const page of pages) {
    try {
      if (await embedPageById(db, String(page._id))) embeddedPages += 1
    } catch (error) {
      console.warn('Failed to embed page', page._id, error)
    }
  }

  const messages = await db.collection('doubtMessages')
    .find({
      user_id: userId,
      course_id: { $in: courseIds },
      embedding: { $exists: false },
    })
    .project({ _id: 1 })
    .limit(200)
    .toArray()

  let embeddedMessages = 0
  for (const message of messages) {
    try {
      if (await embedDoubtMessageById(db, String(message._id))) embeddedMessages += 1
    } catch (error) {
      console.warn('Failed to embed doubt message', message._id, error)
    }
  }

  const sourceChunks = await db.collection('sourceChunks')
    .find({
      user_id: userId,
      course_id: { $in: courseIds },
      embedding: { $exists: false },
    })
    .project({ _id: 1 })
    .limit(200)
    .toArray()

  let embeddedSourceChunks = 0
  for (const chunk of sourceChunks) {
    try {
      if (await embedSourceChunkById(db, String(chunk._id))) embeddedSourceChunks += 1
    } catch (error) {
      console.warn('Failed to embed source chunk', chunk._id, error)
    }
  }

  return {
    pages: embeddedPages,
    doubtMessages: embeddedMessages,
    sourceChunks: embeddedSourceChunks,
  }
}
