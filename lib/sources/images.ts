// Image-aware retrieval + shared types for source-extracted images.
//
// Image counts per course are small (capped at MAX_IMAGES per document), so a
// cosine scan over caption embeddings is exact, index-free, and fast — no Atlas
// vector index required for this corpus.

import type { Db } from 'mongodb'
import { embedText } from '@/lib/ai/embeddings'

/** An image asset shaped for the client renderer + AI generation context. */
export type SourceImageAsset = {
  id: string
  url: string
  caption: string
  figureLabel: string
  classification: string
  chartType: string
  ocrText: string
  page: number
  relevance: number
  width: number | null
  height: number | null
  sourceTitle: string | null
  score?: number
}

function toAsset(doc: any): SourceImageAsset {
  return {
    id: String(doc._id),
    url: `/api/sources/images/${String(doc._id)}`,
    caption: String(doc.caption ?? ''),
    figureLabel: String(doc.figure_label ?? ''),
    classification: String(doc.classification ?? 'other'),
    chartType: String(doc.chart_type ?? ''),
    ocrText: String(doc.ocr_text ?? ''),
    page: Number(doc.page ?? 1),
    relevance: Number(doc.relevance ?? 0),
    width: doc.width != null ? Number(doc.width) : null,
    height: doc.height != null ? Number(doc.height) : null,
    sourceTitle: doc.source_title ? String(doc.source_title) : null,
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function searchTerms(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((term) => term.length >= 4),
  )
}

function lexicalScore(query: string, doc: any) {
  const queryTerms = searchTerms(query)
  if (!queryTerms.size) return 0
  const figureTerms = searchTerms([
    doc.figure_label,
    doc.caption,
    doc.ocr_text,
    doc.nearby_text,
    doc.classification,
    doc.chart_type,
  ].filter(Boolean).join(' '))
  let matches = 0
  for (const term of queryTerms) {
    if (figureTerms.has(term)) matches += 1
  }
  return matches / queryTerms.size
}

/**
 * Find the images from a course's sources most relevant to a query (lesson focus,
 * topic title, or doubt question). Falls back to highest editorial relevance when
 * no query embedding is available.
 */
export async function findRelevantSourceImages(
  db: Db,
  {
    courseId,
    userId,
    queryText,
    limit = 4,
    minRelevance = 50,
    minScore = Number(process.env.SOURCE_IMAGE_MIN_SCORE) || 0.66,
  }: {
    courseId: string
    userId: string
    queryText?: string | null
    limit?: number
    minRelevance?: number
    /** Minimum caption-similarity (cosine) for a figure to be offered to a lesson.
     *  Off-topic figures (e.g. a neural-net diagram on a decision-tree page) score
     *  well below this and are dropped — no figure beats a wrong figure. */
    minScore?: number
  },
): Promise<SourceImageAsset[]> {
  const docs = await db.collection('sourceImages')
    .find({ course_id: courseId, user_id: userId, relevance: { $gte: minRelevance } })
    .toArray()
  if (!docs.length) return []

  const query = queryText?.trim()

  // No query → caller wants a topic-blind list (e.g. a gallery). Only here is it
  // safe to order by editorial relevance without a topic match.
  if (!query) {
    return docs
      .sort((a, b) =>
        Number(b.relevance ?? 0) - Number(a.relevance ?? 0)
        || Number(a.page ?? 0) - Number(b.page ?? 0))
      .slice(0, limit)
      .map(toAsset)
  }

  // Query present → require a genuine semantic match. If we can't embed the query
  // or nothing clears the threshold, return NOTHING rather than a wrong figure.
  let queryEmbedding: number[] | null = null
  try {
    queryEmbedding = await embedText(query, 'RETRIEVAL_QUERY')
  } catch {
    queryEmbedding = null
  }
  if (!queryEmbedding) {
    const lexical = docs
      .map((doc) => ({ doc, score: lexicalScore(query, doc) }))
      .filter(({ score }) => score >= 0.25)
      .sort((a, b) => b.score - a.score || Number(b.doc.relevance ?? 0) - Number(a.doc.relevance ?? 0))
      .slice(0, limit)
      .map(({ doc, score }) => ({ ...toAsset(doc), score }))
    return lexical
  }

  const semantic = docs
    .filter((doc) => Array.isArray(doc.embedding) && doc.embedding.length)
    .map((doc) => ({ doc, score: cosine(queryEmbedding!, doc.embedding as number[]) }))
    .filter(({ score }) => score >= minScore)   // ← topic gate: drop weak/off-topic matches
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ doc, score }) => ({ ...toAsset(doc), score }))
  if (semantic.length) return semantic

  const lexical = docs
    .map((doc) => ({ doc, score: lexicalScore(query, doc) }))
    .filter(({ score }) => score >= 0.25)
    .sort((a, b) => b.score - a.score || Number(b.doc.relevance ?? 0) - Number(a.doc.relevance ?? 0))
    .slice(0, limit)
    .map(({ doc, score }) => ({ ...toAsset(doc), score }))
  return lexical
}

/** Fetch every image for a course (e.g. a "figures in this source" gallery). */
export async function listCourseSourceImages(
  db: Db,
  courseId: string,
  userId: string,
): Promise<SourceImageAsset[]> {
  const docs = await db.collection('sourceImages')
    .find({ course_id: courseId, user_id: userId })
    .sort({ source_index: 1, page: 1, order: 1 })
    .toArray()
  return docs.map(toAsset)
}
