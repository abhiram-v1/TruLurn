import crypto from 'crypto'
import type { Db } from 'mongodb'
import {
  ACTIVE_EMBEDDING_DIMENSIONS,
  ACTIVE_EMBEDDING_MODEL,
  ACTIVE_EMBEDDING_PROVIDER,
  ACTIVE_EMBEDDING_VERSION,
  embedText,
} from '@/lib/ai/embeddings'
import { LEXICAL_INDEX_NAMES, VECTOR_INDEX_NAMES } from '@/lib/vector/indexes'
import { denseRank, hybridRank, tokenize, type RetrievalMethod } from '@/lib/vector/ranking'
import {
  resolveRetrievalCutover,
  type RetrievalSelectionVersion,
} from '@/lib/vector/cutover'
import { embedSourcePassageById } from '@/lib/sources/ingestion'
import type { LessonHardStampedInsight } from '@/types'

export type RetrievalWorkflow =
  | 'generic'
  | 'lesson_generation'
  | 'doubt_answer'
  | 'topic_planning'

type RetrievalEvidence = {
  retrieval_methods?: RetrievalMethod[]
  dense_score?: number | null
  lexical_score?: number | null
  fused_score?: number
}

export type RelevantPage = RetrievalEvidence & {
  id: string
  topic_id: string
  topic_title: string
  page_number: number
  focus: string | null
  summary: string | null
  content: string
  score: number | null
  hard_stamped_insights?: LessonHardStampedInsight[]
}

export type RelevantDoubtMemory = RetrievalEvidence & {
  id: string
  topic_id: string
  topic_title: string | null
  page_number: number | null
  role: 'user'
  content: string
  score: number | null
}

export type RelevantSourceChunk = RetrievalEvidence & {
  id: string
  topic_id: string | null
  source_title: string | null
  source_document_id?: string | null
  source_version_id?: string | null
  source_index?: number | null
  passage_ordinal?: number | null
  heading_path?: string[]
  block_ordinals?: number[]
  char_start?: number | null
  char_end?: number | null
  content: string
  score: number | null
}

export type CourseMemoryContext = {
  pages: RelevantPage[]
  doubtMessages: RelevantDoubtMemory[]
  sourceChunks: RelevantSourceChunk[]
  traceId: string | null
}

type RetrievalDiagnostics = {
  errors: Array<{
    corpus: 'query' | 'pages' | 'doubtMessages' | 'sourceChunks'
    stage: 'embedding' | 'dense' | 'lexical'
    message: string
  }>
  candidates: Record<
    'pages' | 'doubtMessages' | 'sourceChunks',
    { dense: number; lexical: number; selected: number }
  >
  denseBaselineIds: Record<'pages' | 'doubtMessages' | 'sourceChunks', string[]>
  hybridCandidateIds: Record<'pages' | 'doubtMessages' | 'sourceChunks', string[]>
}

export type SourceIndexReadiness = {
  ready: boolean
  indexReady: boolean
  total: number
  readyCount: number
  pendingCount: number
  failedCount: number
  embeddingVersion: string
}

function tenantFilter(courseId: string, userId: string) {
  return {
    course_id: courseId,
    user_id: userId,
    embedding_version: ACTIVE_EMBEDDING_VERSION,
  }
}

function recordRetrievalError(
  diagnostics: RetrievalDiagnostics | undefined,
  corpus: 'pages' | 'doubtMessages' | 'sourceChunks',
  stage: 'embedding' | 'dense' | 'lexical',
  error: unknown,
) {
  const message = error instanceof Error ? error.message : String(error)
  diagnostics?.errors.push({ corpus, stage, message })
  console.warn(`[retrieval] ${corpus} ${stage} retrieval failed.`, error)
}

const RETRIEVAL_POLICIES: Record<
  RetrievalWorkflow,
  {
    pageMinimumScore: number
    doubtMinimumScore: number
    sourceMinimumScore: number
    candidateMultiplier: number
    maxPerGroup: number
    pageCharacterBudget: number
    doubtCharacterBudget: number
    sourceCharacterBudget: number
  }
> = {
  generic: {
    pageMinimumScore: 0.16,
    doubtMinimumScore: 0.17,
    sourceMinimumScore: 0.15,
    candidateMultiplier: 6,
    maxPerGroup: 2,
    pageCharacterBudget: 7_000,
    doubtCharacterBudget: 3_000,
    sourceCharacterBudget: 10_000,
  },
  lesson_generation: {
    pageMinimumScore: 0.18,
    doubtMinimumScore: 0.2,
    sourceMinimumScore: 0.15,
    candidateMultiplier: 8,
    maxPerGroup: 2,
    pageCharacterBudget: 5_000,
    doubtCharacterBudget: 0,
    sourceCharacterBudget: 24_000,
  },
  doubt_answer: {
    pageMinimumScore: 0.15,
    doubtMinimumScore: 0.17,
    sourceMinimumScore: 0.14,
    candidateMultiplier: 8,
    maxPerGroup: 2,
    pageCharacterBudget: 9_000,
    doubtCharacterBudget: 4_000,
    sourceCharacterBudget: 10_000,
  },
  topic_planning: {
    pageMinimumScore: 0.14,
    doubtMinimumScore: 0.18,
    sourceMinimumScore: 0.13,
    candidateMultiplier: 10,
    maxPerGroup: 3,
    pageCharacterBudget: 3_000,
    doubtCharacterBudget: 1_500,
    sourceCharacterBudget: 8_000,
  },
}

function applyContentBudget<T extends { content: string }>(
  items: T[],
  characterBudget: number,
) {
  if (!items.length || characterBudget <= 0) return characterBudget <= 0 ? [] : items
  const perItemBudget = Math.max(240, Math.floor(characterBudget / items.length))
  return items.map((item) => ({
    ...item,
    content: item.content.length > perItemBudget
      ? `${item.content.slice(0, Math.max(0, perItemBudget - 1)).trimEnd()}…`
      : item.content,
  }))
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

  await db.collection('pages').updateOne(
    { _id: page._id },
    { $set: { embedding_status: 'processing', embedding_error: null } },
  )

  try {
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
          embedding_provider: ACTIVE_EMBEDDING_PROVIDER,
          embedding_model: ACTIVE_EMBEDDING_MODEL,
          embedding_dimensions: ACTIVE_EMBEDDING_DIMENSIONS,
          embedding_version: ACTIVE_EMBEDDING_VERSION,
          embedding_status: 'ready',
          embedding_error: null,
          embedding_updated_at: new Date(),
        },
      },
    )
  } catch (error) {
    await db.collection('pages').updateOne(
      { _id: page._id },
      {
        $set: {
          embedding_status: 'failed',
          embedding_error: error instanceof Error ? error.message : String(error),
          embedding_updated_at: new Date(),
        },
      },
    )
    throw error
  }

  return true
}

export async function embedSourceChunkById(db: Db, chunkId: string) {
  const chunk = await db.collection('sourceChunks').findOne({ _id: chunkId as any })
  if (!chunk) return false

  await db.collection('sourceChunks').updateOne(
    { _id: chunk._id },
    { $set: { embedding_status: 'processing', embedding_error: null } },
  )

  try {
    const text = sourceChunkEmbeddingText(chunk)
    if (!text.trim()) {
      throw new Error('Source chunk has no embeddable text.')
    }
    const embedding = await embedText(text, 'RETRIEVAL_DOCUMENT')

    await db.collection('sourceChunks').updateOne(
      { _id: chunk._id },
      {
        $set: {
          embedding,
          embedding_provider: ACTIVE_EMBEDDING_PROVIDER,
          embedding_model: ACTIVE_EMBEDDING_MODEL,
          embedding_dimensions: ACTIVE_EMBEDDING_DIMENSIONS,
          embedding_version: ACTIVE_EMBEDDING_VERSION,
          embedding_status: 'ready',
          embedding_error: null,
          embedding_updated_at: new Date(),
        },
      },
    )
  } catch (error) {
    await db.collection('sourceChunks').updateOne(
      { _id: chunk._id },
      {
        $set: {
          embedding_status: 'failed',
          embedding_error: error instanceof Error ? error.message : String(error),
          embedding_updated_at: new Date(),
        },
      },
    )
    throw error
  }

  return true
}

export async function embedDoubtMessageById(db: Db, messageId: string) {
  const message = await db.collection('doubtMessages').findOne({ _id: messageId as any })
  if (!message) return false
  if (message.role !== 'user') {
    await db.collection('doubtMessages').updateOne(
      { _id: message._id },
      {
        $set: {
          retrieval_eligible: false,
          embedding_status: 'excluded',
          embedding_error: null,
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
    return false
  }

  await db.collection('doubtMessages').updateOne(
    { _id: message._id },
    { $set: { retrieval_eligible: true, embedding_status: 'processing', embedding_error: null } },
  )

  try {
    const topic = await db.collection('topics').findOne({
      _id: message.topic_id as any,
      course_id: message.course_id,
    })
    const embedding = await embedText(
      doubtEmbeddingText({ ...message, topic_title: topic?.title }),
      'RETRIEVAL_DOCUMENT',
    )

    await db.collection('doubtMessages').updateOne(
      { _id: message._id },
      {
        $set: {
          embedding,
          embedding_provider: ACTIVE_EMBEDDING_PROVIDER,
          embedding_model: ACTIVE_EMBEDDING_MODEL,
          embedding_dimensions: ACTIVE_EMBEDDING_DIMENSIONS,
          embedding_version: ACTIVE_EMBEDDING_VERSION,
          embedding_status: 'ready',
          embedding_error: null,
          embedding_updated_at: new Date(),
        },
      },
    )
  } catch (error) {
    await db.collection('doubtMessages').updateOne(
      { _id: message._id },
      {
        $set: {
          embedding_status: 'failed',
          embedding_error: error instanceof Error ? error.message : String(error),
          embedding_updated_at: new Date(),
        },
      },
    )
    throw error
  }

  return true
}

export async function findRelevantPages({
  db,
  query,
  queryVector: precomputedVector,
  courseId,
  userId,
  excludeTopicId,
  limit = 2,
  minimumScore = RETRIEVAL_POLICIES.generic.pageMinimumScore,
  candidateMultiplier = RETRIEVAL_POLICIES.generic.candidateMultiplier,
  maxPerGroup = RETRIEVAL_POLICIES.generic.maxPerGroup,
  skipDense = false,
  selectionVersion = 'hybrid-v2',
  collectShadow = true,
  diagnostics,
  allowedTopicIds,
}: {
  db: Db
  query: string
  queryVector?: number[]
  courseId: string
  userId: string
  excludeTopicId: string
  limit?: number
  minimumScore?: number
  candidateMultiplier?: number
  maxPerGroup?: number
  skipDense?: boolean
  selectionVersion?: RetrievalSelectionVersion
  collectShadow?: boolean
  diagnostics?: RetrievalDiagnostics
  /** Only pages from topics the learner could already have encountered. */
  allowedTopicIds?: string[]
}): Promise<RelevantPage[]> {
  if (limit <= 0) return []
  const eligibleTopicIds = allowedTopicIds
    ? [...new Set(allowedTopicIds.map(String).filter((id) => id && id !== excludeTopicId))]
    : null
  if (eligibleTopicIds && eligibleTopicIds.length === 0) return []
  const candidateLimit = Math.max(20, limit * candidateMultiplier)
  let queryVector = precomputedVector
  if (!skipDense && !queryVector) {
    try {
      queryVector = await embedText(query, 'QUESTION_ANSWERING')
    } catch (error) {
      recordRetrievalError(diagnostics, 'pages', 'embedding', error)
    }
  }

  const densePromise = !skipDense && queryVector
    ? db.collection('pages').aggregate([
        {
          $vectorSearch: {
            index: VECTOR_INDEX_NAMES.pages,
            path: 'embedding',
            queryVector,
            numCandidates: Math.max(100, candidateLimit * 10),
            limit: candidateLimit,
            filter: {
              ...tenantFilter(courseId, userId),
              topic_id: eligibleTopicIds
                ? { $in: eligibleTopicIds }
                : { $ne: excludeTopicId },
            },
          },
        },
        // A failed re-embed can leave an older vector on the document. Do not
        // let that stale vector enter lesson or doubt context.
        { $match: { embedding_status: 'ready' } },
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
            hard_stamped_insights: 1,
            topic_title: { $first: '$topic.title' },
            score: { $meta: 'vectorSearchScore' },
          },
        },
      ]).toArray().catch((error) => {
        recordRetrievalError(diagnostics, 'pages', 'dense', error)
        return []
      })
    : Promise.resolve([])

  const lexicalPromise = collectShadow ? db.collection('pages').aggregate([
    {
      $search: {
        index: LEXICAL_INDEX_NAMES.pages,
        compound: {
          should: [
            { text: { query, path: 'content' } },
            {
              text: {
                query,
                path: ['focus', 'summary'],
                score: { boost: { value: 1.8 } },
              },
            },
          ],
          minimumShouldMatch: 1,
          filter: [
            { equals: { path: 'course_id', value: courseId } },
            { equals: { path: 'user_id', value: userId } },
            { equals: { path: 'embedding_version', value: ACTIVE_EMBEDDING_VERSION } },
            ...(eligibleTopicIds
              ? [{ in: { path: 'topic_id', value: eligibleTopicIds } }]
              : []),
          ],
          mustNot: eligibleTopicIds
            ? []
            : [{ equals: { path: 'topic_id', value: excludeTopicId } }],
        },
      },
    },
    { $match: { embedding_status: 'ready' } },
    { $limit: candidateLimit },
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
        hard_stamped_insights: 1,
        topic_title: { $first: '$topic.title' },
        score: { $meta: 'searchScore' },
      },
    },
  ]).toArray().catch((error) => {
    recordRetrievalError(diagnostics, 'pages', 'lexical', error)
    return []
  }) : Promise.resolve([])

  const [denseResults, lexicalResults] = await Promise.all([densePromise, lexicalPromise])
  const mapPage = (page: any): RelevantPage => ({
      id: String(page._id),
      topic_id: String(page.topic_id),
      topic_title: page.topic_title ?? 'Earlier topic',
      page_number: page.page_number,
      focus: page.focus ?? null,
      summary: page.summary ?? null,
      content: page.content,
      score: typeof page.score === 'number' ? page.score : null,
      hard_stamped_insights: Array.isArray(page.hard_stamped_insights) ? page.hard_stamped_insights : [],
    })
  const toCandidate = (page: any) => {
    const item = mapPage(page)
    return {
      id: item.id,
      item,
      text: [
        item.topic_title,
        item.focus,
        item.summary,
        ...(item.hard_stamped_insights ?? []).flatMap((stamp) => [stamp.statement, stamp.mapping, stamp.boundary]),
        item.content,
      ].filter(Boolean).join('\n'),
      groupKey: item.topic_id,
      score: item.score,
    }
  }
  const denseRanked = denseRank({
    dense: denseResults.map(toCandidate),
    limit,
    minimumScore,
    maxPerGroup,
  })
  const hybridRanked = hybridRank({
    query,
    dense: denseResults.map(toCandidate),
    lexical: lexicalResults.map(toCandidate),
    limit,
    minimumScore,
    maxPerGroup,
  })
  const ranked = selectionVersion === 'hybrid-v2' ? hybridRanked : denseRanked
  diagnostics && (diagnostics.candidates.pages = {
    dense: denseResults.length,
    lexical: lexicalResults.length,
    selected: ranked.length,
  })
  if (diagnostics) {
    diagnostics.denseBaselineIds.pages = denseRanked.map((candidate) => candidate.id)
    diagnostics.hybridCandidateIds.pages = collectShadow
      ? hybridRanked.map((candidate) => candidate.id)
      : []
  }
  return ranked.map((candidate) => ({
    ...candidate.item,
    content: candidate.item.content.slice(0, 5_000),
    score: candidate.rerankScore,
    retrieval_methods: candidate.methods,
    dense_score: candidate.denseScore,
    lexical_score: candidate.lexicalScore,
    fused_score: candidate.fusedScore,
  }))
}

function lexicalCoverage(query: string, candidate: string) {
  const queryTokens = new Set(tokenize(query))
  if (!queryTokens.size) return 0
  const candidateTokens = new Set(tokenize(candidate))
  let matches = 0
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) matches += 1
  }
  return matches / queryTokens.size
}

/**
 * Deterministic dependency retrieval. Vector similarity is useful for discovery,
 * but it must never be the only route to a declared prerequisite. This fallback
 * selects the most relevant generated page from every required earlier topic,
 * even when its embedding is missing or its wording differs from the new topic.
 */
export async function findRequiredPageAnchors({
  db,
  query,
  courseId,
  userId,
  requiredTopicIds,
  maxPerTopic = 1,
}: {
  db: Db
  query: string
  courseId: string
  userId: string
  requiredTopicIds: string[]
  maxPerTopic?: number
}): Promise<RelevantPage[]> {
  const required = [...new Set(requiredTopicIds.map(String).filter(Boolean))]
  if (!required.length || maxPerTopic <= 0) return []

  const [pages, topics] = await Promise.all([
    db.collection('pages')
      .find({
        course_id: courseId,
        user_id: userId,
        topic_id: { $in: required },
        content: { $type: 'string', $ne: '' },
      })
      .project({
        _id: 1,
        topic_id: 1,
        page_number: 1,
        focus: 1,
        summary: 1,
        key_concepts: 1,
        content: 1,
        hard_stamped_insights: 1,
      })
      .toArray(),
    db.collection('topics')
      .find({ course_id: courseId, _id: { $in: required as any[] } })
      .project({ title: 1 })
      .toArray(),
  ])
  const titles = new Map(topics.map((topic) => [String(topic._id), String(topic.title ?? 'Earlier topic')]))
  const grouped = new Map<string, Array<{ page: any; relevance: number }>>()

  for (const page of pages) {
    const topicId = String(page.topic_id)
    const text = [
      titles.get(topicId),
      page.focus,
      page.summary,
      ...(Array.isArray(page.key_concepts) ? page.key_concepts : []),
      page.content,
    ].filter(Boolean).join('\n')
    const relevance = lexicalCoverage(query, text) + Math.min(0.08, Number(page.page_number ?? 0) * 0.005)
    const bucket = grouped.get(topicId) ?? []
    bucket.push({ page, relevance })
    grouped.set(topicId, bucket)
  }

  const selected: RelevantPage[] = []
  for (const topicId of required) {
    const candidates = grouped.get(topicId) ?? []
    candidates.sort((left, right) =>
      right.relevance - left.relevance
      || Number(right.page.page_number ?? 0) - Number(left.page.page_number ?? 0)
    )
    for (const { page, relevance } of candidates.slice(0, maxPerTopic)) {
      selected.push({
        id: String(page._id),
        topic_id: topicId,
        topic_title: titles.get(topicId) ?? 'Earlier topic',
        page_number: Number(page.page_number ?? 0),
        focus: page.focus ?? null,
        summary: page.summary ?? null,
        content: String(page.content ?? '').slice(0, 5_000),
        score: relevance,
        hard_stamped_insights: Array.isArray(page.hard_stamped_insights) ? page.hard_stamped_insights : [],
        retrieval_methods: ['dependency'],
        dense_score: null,
        lexical_score: relevance,
        fused_score: relevance,
      })
    }
  }
  return selected
}

export function mergeCourseMemoryPages({
  required,
  relevant,
  limit,
}: {
  required: RelevantPage[]
  relevant: RelevantPage[]
  limit: number
}) {
  const merged: RelevantPage[] = []
  const seen = new Set<string>()
  for (const page of [...required, ...relevant]) {
    if (seen.has(page.id)) continue
    seen.add(page.id)
    merged.push(page)
    if (merged.length >= Math.max(limit, required.length)) break
  }
  return merged
}

export async function findRelevantDoubtMessages({
  db,
  query,
  queryVector: precomputedVector,
  courseId,
  userId,
  excludeTopicId,
  limit = 4,
  minimumScore = RETRIEVAL_POLICIES.generic.doubtMinimumScore,
  candidateMultiplier = RETRIEVAL_POLICIES.generic.candidateMultiplier,
  maxPerGroup = RETRIEVAL_POLICIES.generic.maxPerGroup,
  skipDense = false,
  selectionVersion = 'hybrid-v2',
  collectShadow = true,
  diagnostics,
}: {
  db: Db
  query: string
  queryVector?: number[]
  courseId: string
  userId: string
  excludeTopicId?: string
  limit?: number
  minimumScore?: number
  candidateMultiplier?: number
  maxPerGroup?: number
  skipDense?: boolean
  selectionVersion?: RetrievalSelectionVersion
  collectShadow?: boolean
  diagnostics?: RetrievalDiagnostics
}): Promise<RelevantDoubtMemory[]> {
  if (limit <= 0) return []
  const candidateLimit = Math.max(20, limit * candidateMultiplier)
  let queryVector = precomputedVector
  if (!skipDense && !queryVector) {
    try {
      queryVector = await embedText(query, 'QUESTION_ANSWERING')
    } catch (error) {
      recordRetrievalError(diagnostics, 'doubtMessages', 'embedding', error)
    }
  }
  const filter: Record<string, unknown> = {
    ...tenantFilter(courseId, userId),
    role: 'user',
  }
  if (excludeTopicId) filter.topic_id = { $ne: excludeTopicId }

  const densePromise = !skipDense && queryVector
    ? db.collection('doubtMessages').aggregate([
        {
          $vectorSearch: {
            index: VECTOR_INDEX_NAMES.doubtMessages,
            path: 'embedding',
            queryVector,
            numCandidates: Math.max(100, candidateLimit * 10),
            limit: candidateLimit,
            filter,
          },
        },
        // See the matching pages retrieval guard above.
        { $match: { embedding_status: 'ready' } },
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
      ]).toArray().catch((error) => {
        recordRetrievalError(diagnostics, 'doubtMessages', 'dense', error)
        return []
      })
    : Promise.resolve([])

  const lexicalFilters: Array<Record<string, unknown>> = [
    { equals: { path: 'course_id', value: courseId } },
    { equals: { path: 'user_id', value: userId } },
    { equals: { path: 'embedding_version', value: ACTIVE_EMBEDDING_VERSION } },
    { equals: { path: 'role', value: 'user' } },
  ]
  const compound: Record<string, unknown> = {
    must: [{ text: { query, path: 'content' } }],
    filter: lexicalFilters,
  }
  if (excludeTopicId) {
    compound.mustNot = [{ equals: { path: 'topic_id', value: excludeTopicId } }]
  }
  const lexicalPromise = collectShadow ? db.collection('doubtMessages').aggregate([
    { $search: { index: LEXICAL_INDEX_NAMES.doubtMessages, compound } },
    { $match: { embedding_status: 'ready' } },
    { $limit: candidateLimit },
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
        score: { $meta: 'searchScore' },
      },
    },
  ]).toArray().catch((error) => {
    recordRetrievalError(diagnostics, 'doubtMessages', 'lexical', error)
    return []
  }) : Promise.resolve([])

  const [denseResults, lexicalResults] = await Promise.all([densePromise, lexicalPromise])
  const mapMessage = (message: any): RelevantDoubtMemory => ({
      id: String(message._id),
      topic_id: String(message.topic_id),
      topic_title: message.topic_title ?? null,
      page_number: typeof message.page_number === 'number' ? message.page_number : null,
      role: 'user' as const,
      content: String(message.content ?? ''),
      score: typeof message.score === 'number' ? message.score : null,
    })
  const toCandidate = (message: any) => {
    const item = mapMessage(message)
    return {
      id: item.id,
      item,
      text: [item.topic_title, item.content].filter(Boolean).join('\n'),
      groupKey: item.topic_id,
      score: item.score,
    }
  }
  const denseRanked = denseRank({
    dense: denseResults.map(toCandidate),
    limit,
    minimumScore,
    maxPerGroup,
  })
  const hybridRanked = hybridRank({
    query,
    dense: denseResults.map(toCandidate),
    lexical: lexicalResults.map(toCandidate),
    limit,
    minimumScore,
    maxPerGroup,
  })
  const ranked = selectionVersion === 'hybrid-v2' ? hybridRanked : denseRanked
  diagnostics && (diagnostics.candidates.doubtMessages = {
    dense: denseResults.length,
    lexical: lexicalResults.length,
    selected: ranked.length,
  })
  if (diagnostics) {
    diagnostics.denseBaselineIds.doubtMessages = denseRanked.map((candidate) => candidate.id)
    diagnostics.hybridCandidateIds.doubtMessages = collectShadow
      ? hybridRanked.map((candidate) => candidate.id)
      : []
  }
  return ranked.map((candidate) => ({
    ...candidate.item,
    content: candidate.item.content.slice(0, 2_000),
    score: candidate.rerankScore,
    retrieval_methods: candidate.methods,
    dense_score: candidate.denseScore,
    lexical_score: candidate.lexicalScore,
    fused_score: candidate.fusedScore,
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
  minimumScore = RETRIEVAL_POLICIES.generic.sourceMinimumScore,
  candidateMultiplier = RETRIEVAL_POLICIES.generic.candidateMultiplier,
  maxPerGroup = RETRIEVAL_POLICIES.generic.maxPerGroup,
  skipDense = false,
  selectionVersion = 'hybrid-v2',
  collectShadow = true,
  diagnostics,
}: {
  db: Db
  query: string
  queryVector?: number[]
  courseId: string
  userId: string
  topicId?: string
  limit?: number
  minimumScore?: number
  candidateMultiplier?: number
  maxPerGroup?: number
  skipDense?: boolean
  selectionVersion?: RetrievalSelectionVersion
  collectShadow?: boolean
  diagnostics?: RetrievalDiagnostics
}): Promise<RelevantSourceChunk[]> {
  if (limit <= 0) return []
  const hasPassages = await db.collection('sourcePassages')
    .findOne({ course_id: courseId, user_id: userId }, { projection: { _id: 1 } })
    .catch(() => null)
  const collectionName = hasPassages ? 'sourcePassages' : 'sourceChunks'
  const vectorIndex = hasPassages
    ? VECTOR_INDEX_NAMES.sourcePassages
    : VECTOR_INDEX_NAMES.sourceChunks
  const lexicalIndex = hasPassages
    ? LEXICAL_INDEX_NAMES.sourcePassages
    : LEXICAL_INDEX_NAMES.sourceChunks
  const candidateLimit = Math.max(20, limit * candidateMultiplier)
  let queryVector = precomputedVector
  if (!skipDense && !queryVector) {
    try {
      queryVector = await embedText(query, 'QUESTION_ANSWERING')
    } catch (error) {
      recordRetrievalError(diagnostics, 'sourceChunks', 'embedding', error)
    }
  }

  const densePromise = !skipDense && queryVector
    ? db.collection(collectionName).aggregate([
        {
          $vectorSearch: {
            index: vectorIndex,
            path: 'embedding',
            queryVector,
            numCandidates: Math.max(100, candidateLimit * 10),
            limit: candidateLimit,
            filter: tenantFilter(courseId, userId),
          },
        },
        { $match: { embedding_status: 'ready' } },
        {
          $project: {
            _id: 1,
            topic_id: 1,
            source_title: 1,
            title: 1,
            source_document_id: 1,
            source_version_id: 1,
            source_index: 1,
            ordinal: 1,
            passage_ordinal: 1,
            chunk_index: 1,
            heading_path: 1,
            block_ordinals: 1,
            char_start: 1,
            char_end: 1,
            content: 1,
            text: 1,
            chunk_text: 1,
            score: { $meta: 'vectorSearchScore' },
          },
        },
      ]).toArray().catch((error) => {
        recordRetrievalError(diagnostics, 'sourceChunks', 'dense', error)
        return []
      })
    : Promise.resolve([])

  const lexicalPromise = collectShadow ? db.collection(collectionName).aggregate([
    {
      $search: {
        index: lexicalIndex,
        compound: {
          should: [
            { text: { query, path: 'content' } },
            {
              text: {
                query,
                path: ['source_title', 'heading_path'],
                score: { boost: { value: 1.5 } },
              },
            },
          ],
          minimumShouldMatch: 1,
          filter: [
            { equals: { path: 'course_id', value: courseId } },
            { equals: { path: 'user_id', value: userId } },
          ],
        },
      },
    },
    { $match: { embedding_status: 'ready' } },
    { $limit: candidateLimit },
    {
      $project: {
        _id: 1,
        topic_id: 1,
        source_title: 1,
        title: 1,
        source_document_id: 1,
        source_version_id: 1,
        source_index: 1,
        ordinal: 1,
        passage_ordinal: 1,
        chunk_index: 1,
        heading_path: 1,
        block_ordinals: 1,
        char_start: 1,
        char_end: 1,
        content: 1,
        text: 1,
        chunk_text: 1,
        score: { $meta: 'searchScore' },
      },
    },
  ]).toArray().catch((error) => {
    recordRetrievalError(diagnostics, 'sourceChunks', 'lexical', error)
    return []
  }) : Promise.resolve([])

  const [denseResults, lexicalResults] = await Promise.all([densePromise, lexicalPromise])
  const mapChunk = (chunk: any): RelevantSourceChunk => ({
      id: String(chunk._id),
      topic_id: chunk.topic_id ? String(chunk.topic_id) : null,
      source_title: chunk.source_title ?? chunk.title ?? null,
      source_document_id: chunk.source_document_id ? String(chunk.source_document_id) : null,
      source_version_id: chunk.source_version_id ? String(chunk.source_version_id) : null,
      source_index: Number.isFinite(Number(chunk.source_index)) ? Number(chunk.source_index) : null,
      passage_ordinal: Number.isFinite(Number(
        chunk.passage_ordinal ?? chunk.ordinal ?? chunk.chunk_index,
      ))
        ? Number(chunk.passage_ordinal ?? chunk.ordinal ?? chunk.chunk_index)
        : null,
      heading_path: Array.isArray(chunk.heading_path)
        ? chunk.heading_path.map(String)
        : undefined,
      block_ordinals: Array.isArray(chunk.block_ordinals)
        ? chunk.block_ordinals.map(Number).filter(Number.isFinite)
        : undefined,
      char_start: Number.isFinite(Number(chunk.char_start)) ? Number(chunk.char_start) : null,
      char_end: Number.isFinite(Number(chunk.char_end)) ? Number(chunk.char_end) : null,
      content: String(chunk.content ?? chunk.text ?? chunk.chunk_text ?? ''),
      score: typeof chunk.score === 'number' ? chunk.score : null,
    })
  const toCandidate = (chunk: any) => {
    const item = mapChunk(chunk)
    return {
      id: item.id,
      item,
      text: [
        item.source_title,
        item.heading_path?.join(' > '),
        item.content,
      ].filter(Boolean).join('\n'),
      groupKey: item.source_document_id ?? item.source_title ?? item.topic_id,
      score: item.score,
    }
  }
  const denseRanked = denseRank({
    dense: denseResults.map(toCandidate),
    limit,
    minimumScore,
    maxPerGroup,
  })
  const hybridRanked = hybridRank({
    query,
    dense: denseResults.map(toCandidate),
    lexical: lexicalResults.map(toCandidate),
    limit,
    minimumScore,
    maxPerGroup,
  })
  const ranked = selectionVersion === 'hybrid-v2' ? hybridRanked : denseRanked
  diagnostics && (diagnostics.candidates.sourceChunks = {
    dense: denseResults.length,
    lexical: lexicalResults.length,
    selected: ranked.length,
  })
  if (diagnostics) {
    diagnostics.denseBaselineIds.sourceChunks = denseRanked.map((candidate) => candidate.id)
    diagnostics.hybridCandidateIds.sourceChunks = collectShadow
      ? hybridRanked.map((candidate) => candidate.id)
      : []
  }
  return ranked.map((candidate) => ({
    ...candidate.item,
    content: candidate.item.content.slice(0, 6_000),
    score: candidate.rerankScore,
    retrieval_methods: candidate.methods,
    dense_score: candidate.denseScore,
    lexical_score: candidate.lexicalScore,
    fused_score: candidate.fusedScore,
  }))
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
  workflow = 'generic',
  allowedPageTopicIds,
  requiredPageTopicIds = [],
}: {
  db: Db
  query: string
  courseId: string
  userId: string
  currentTopicId?: string
  pageLimit?: number
  doubtLimit?: number
  sourceLimit?: number
  workflow?: RetrievalWorkflow
  /** Curriculum/sequence gate applied before page candidates are selected. */
  allowedPageTopicIds?: string[]
  /** Earlier dependency/sequence topics that must contribute an anchor page. */
  requiredPageTopicIds?: string[]
}): Promise<CourseMemoryContext> {
  const needsAny = Boolean(
    (currentTopicId && pageLimit > 0)
    || requiredPageTopicIds.length > 0
    || doubtLimit > 0
    || sourceLimit > 0,
  )
  const traceId = crypto.randomUUID()
  const startedAt = new Date()
  const policy = RETRIEVAL_POLICIES[workflow]
  const cutover = await resolveRetrievalCutover(db, {
    workflow,
    userId,
    courseId,
  })
  const diagnostics: RetrievalDiagnostics = {
    errors: [],
    candidates: {
      pages: { dense: 0, lexical: 0, selected: 0 },
      doubtMessages: { dense: 0, lexical: 0, selected: 0 },
      sourceChunks: { dense: 0, lexical: 0, selected: 0 },
    },
    denseBaselineIds: {
      pages: [],
      doubtMessages: [],
      sourceChunks: [],
    },
    hybridCandidateIds: {
      pages: [],
      doubtMessages: [],
      sourceChunks: [],
    },
  }

  // Embed the query ONCE and share the vector across all three sub-functions.
  // Without this, each sub-function independently embeds the same text —
  // three identical embedding API calls per retrieval trigger.
  let sharedVector: number[] | undefined
  if (needsAny) {
    try {
      sharedVector = await embedText(query, 'QUESTION_ANSWERING')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      diagnostics.errors.push({
        corpus: 'query',
        stage: 'embedding',
        message: `Query embedding failed: ${message}`,
      })
      console.warn('[retrieval] Query embedding failed; continuing with lexical retrieval.', error)
    }
  }

  const [relevantPages, requiredPages, doubtMessages, sourceChunks] = await Promise.all([
    currentTopicId && pageLimit > 0
      ? findRelevantPages({
          db,
          query,
          queryVector: sharedVector,
          courseId,
          userId,
          excludeTopicId: currentTopicId,
          limit: pageLimit,
          minimumScore: policy.pageMinimumScore,
          candidateMultiplier: policy.candidateMultiplier,
          maxPerGroup: policy.maxPerGroup,
          skipDense: !sharedVector,
          selectionVersion: cutover.selectionVersion,
          collectShadow: cutover.collectShadow,
          diagnostics,
          allowedTopicIds: allowedPageTopicIds,
        })
      : Promise.resolve([]),
    requiredPageTopicIds.length
      ? findRequiredPageAnchors({
          db,
          query,
          courseId,
          userId,
          requiredTopicIds: requiredPageTopicIds,
        }).catch((error) => {
          recordRetrievalError(diagnostics, 'pages', 'lexical', error)
          return []
        })
      : Promise.resolve([]),
    doubtLimit > 0
      ? findRelevantDoubtMessages({
          db,
          query,
          queryVector: sharedVector,
          courseId,
          userId,
          excludeTopicId: currentTopicId,
          limit: doubtLimit,
          minimumScore: policy.doubtMinimumScore,
          candidateMultiplier: policy.candidateMultiplier,
          maxPerGroup: policy.maxPerGroup,
          skipDense: !sharedVector,
          selectionVersion: cutover.selectionVersion,
          collectShadow: cutover.collectShadow,
          diagnostics,
        })
      : Promise.resolve([]),
    sourceLimit > 0
      ? findRelevantSourceChunks({
          db,
          query,
          queryVector: sharedVector,
          courseId,
          userId,
          topicId: currentTopicId,
          limit: sourceLimit,
          minimumScore: policy.sourceMinimumScore,
          candidateMultiplier: policy.candidateMultiplier,
          maxPerGroup: policy.maxPerGroup,
          skipDense: !sharedVector,
          selectionVersion: cutover.selectionVersion,
          collectShadow: cutover.collectShadow,
          diagnostics,
        })
      : Promise.resolve([]),
  ])
  const pages = mergeCourseMemoryPages({
    required: requiredPages,
    relevant: relevantPages,
    limit: pageLimit,
  })
  diagnostics.candidates.pages.selected = pages.length
  const budgetedPages = applyContentBudget(pages, policy.pageCharacterBudget)
  const budgetedDoubtMessages = applyContentBudget(
    doubtMessages,
    policy.doubtCharacterBudget,
  )
  const budgetedSourceChunks = applyContentBudget(
    sourceChunks,
    policy.sourceCharacterBudget,
  )

  const completedAt = new Date()
  await db.collection('retrievalTraces').insertOne({
    _id: traceId as any,
    user_id: userId,
    course_id: courseId,
    current_topic_id: currentTopicId ?? null,
    query_hash: crypto.createHash('sha256').update(query).digest('hex'),
    query_preview: process.env.RAG_TRACE_QUERY_PREVIEW === '1'
      ? query.replace(/\s+/g, ' ').trim().slice(0, 240)
      : null,
    embedding_provider: ACTIVE_EMBEDDING_PROVIDER,
    embedding_model: ACTIVE_EMBEDDING_MODEL,
    embedding_dimensions: ACTIVE_EMBEDDING_DIMENSIONS,
    embedding_version: ACTIVE_EMBEDDING_VERSION,
    retrieval_version: cutover.selectionVersion,
    workflow,
    policy,
    cutover: {
      mode: cutover.mode,
      rollout_percent: cutover.rolloutPercent,
      cohort_bucket: cutover.cohortBucket,
      canary_selected: cutover.canarySelected,
      selection_version: cutover.selectionVersion,
      shadow_collected: cutover.collectShadow,
      seed: cutover.seed,
    },
    requested_limits: {
      pages: pageLimit,
      doubt_messages: doubtLimit,
      source_chunks: sourceLimit,
    },
    curriculum_scope: {
      allowed_prior_topic_count: allowedPageTopicIds?.length ?? null,
      required_anchor_topic_count: requiredPageTopicIds.length,
      required_anchor_page_count: requiredPages.length,
    },
    candidate_counts: diagnostics.candidates,
    shadow_comparison: {
      baseline: 'dense-v1',
      baseline_selected_ids: diagnostics.denseBaselineIds,
      hybrid_selected_ids: diagnostics.hybridCandidateIds,
      served: cutover.selectionVersion,
    },
    selected: {
      pages: budgetedPages.map((item) => ({
        id: item.id,
        score: item.score,
        methods: item.retrieval_methods,
        dense_score: item.dense_score,
        lexical_score: item.lexical_score,
        fused_score: item.fused_score,
      })),
      doubt_messages: budgetedDoubtMessages.map((item) => ({
        id: item.id,
        score: item.score,
        methods: item.retrieval_methods,
        dense_score: item.dense_score,
        lexical_score: item.lexical_score,
        fused_score: item.fused_score,
      })),
      source_chunks: budgetedSourceChunks.map((item) => ({
        id: item.id,
        score: item.score,
        methods: item.retrieval_methods,
        dense_score: item.dense_score,
        lexical_score: item.lexical_score,
        fused_score: item.fused_score,
      })),
    },
    errors: diagnostics.errors,
    status: diagnostics.errors.length ? 'degraded' : 'completed',
    duration_ms: completedAt.getTime() - startedAt.getTime(),
    created_at: completedAt,
  }).catch((error) => {
    console.warn('[retrieval] Failed to persist retrieval trace.', error)
  })

  return {
    pages: budgetedPages,
    doubtMessages: budgetedDoubtMessages,
    sourceChunks: budgetedSourceChunks,
    traceId,
  }
}

export async function getSourceIndexReadiness(
  db: Db,
  courseId: string,
  userId: string,
): Promise<SourceIndexReadiness> {
  const hasPassages = await db.collection('sourcePassages')
    .findOne({ course_id: courseId, user_id: userId }, { projection: { _id: 1 } })
    .catch(() => null)
  const collectionName = hasPassages ? 'sourcePassages' : 'sourceChunks'
  const vectorIndex = hasPassages
    ? VECTOR_INDEX_NAMES.sourcePassages
    : VECTOR_INDEX_NAMES.sourceChunks
  const [total, readyCount, failedCount, indexes] = await Promise.all([
    db.collection(collectionName).countDocuments({ course_id: courseId, user_id: userId }),
    db.collection(collectionName).countDocuments({
      course_id: courseId,
      user_id: userId,
      embedding_version: ACTIVE_EMBEDDING_VERSION,
      embedding_status: 'ready',
    }),
    db.collection(collectionName).countDocuments({
      course_id: courseId,
      user_id: userId,
      embedding_status: 'failed',
    }),
    db.collection(collectionName).listSearchIndexes(vectorIndex).toArray().catch(() => []),
  ])
  const indexReady = (indexes as Array<Record<string, unknown>>).some((index) =>
    index.queryable === true || String(index.status ?? '').toUpperCase() === 'READY')

  return {
    ready: indexReady && total > 0 && readyCount === total,
    indexReady,
    total,
    readyCount,
    pendingCount: Math.max(0, total - readyCount - failedCount),
    failedCount,
    embeddingVersion: ACTIVE_EMBEDDING_VERSION,
  }
}

export async function backfillCourseSourceEmbeddings(
  db: Db,
  userId: string,
  courseId: string,
  limit = 200,
) {
  const [chunks, passages] = await Promise.all([
    db.collection('sourceChunks')
      .find({
        user_id: userId,
        course_id: courseId,
        embedding_version: { $ne: ACTIVE_EMBEDDING_VERSION },
      })
      .project({ _id: 1 })
      .limit(limit)
      .toArray(),
    db.collection('sourcePassages')
      .find({
        user_id: userId,
        course_id: courseId,
        embedding_version: { $ne: ACTIVE_EMBEDDING_VERSION },
      })
      .project({ _id: 1 })
      .limit(limit)
      .toArray(),
  ])

  let embedded = 0
  for (const chunk of chunks) {
    try {
      if (await embedSourceChunkById(db, String(chunk._id))) embedded += 1
    } catch (error) {
      console.warn('[sourceChunks] Course backfill failed for', chunk._id, error)
    }
  }
  for (const passage of passages) {
    try {
      if (await embedSourcePassageById(db, String(passage._id))) embedded += 1
    } catch (error) {
      console.warn('[sourcePassages] Course backfill failed for', passage._id, error)
    }
  }
  return embedded
}
