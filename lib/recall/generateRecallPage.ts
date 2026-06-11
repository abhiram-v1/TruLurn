import crypto from 'crypto'
import type { Db } from 'mongodb'
import { generateWithGemini } from '@/lib/ai/gemini/client'
import { parseGeminiJson } from '@/lib/ai/gemini/json'
import type { SessionPageEntry, StudySessionDoc } from '@/lib/recall/session'
import { pagesSinceLastBreak } from '@/lib/recall/session'

// ── Recall page generation ────────────────────────────────────────────────────
// Turns the material covered in the current study stretch into an active-recall
// page: quick concept summaries, retrieval questions, and connection questions
// that link concepts across the topics just studied. Questions are self-rated
// (got it / shaky / forgot) — no AI evaluation round-trip, so the break stays fast.

export type RecallItemType = 'recall' | 'connection' | 'application'
export type RecallRating = 'got_it' | 'shaky' | 'forgot'

export type RecallItem = {
  id: string
  type: RecallItemType
  concept: string
  /** Topic the concept came from (for stats attribution). */
  topic_id: string | null
  prompt: string
  answer: string
  rating?: RecallRating | null
}

export type RecallSummaryItem = {
  concept: string
  summary: string
}

export type RecallPageContent = {
  headline: string
  summaries: RecallSummaryItem[]
  items: RecallItem[]
}

export type RecallSessionDoc = {
  _id: string
  user_id: string
  course_id: string
  study_session_id: string
  status: 'open' | 'completed' | 'abandoned'
  trigger: 'auto' | '30m' | '60m' | 'manual'
  headline: string
  summaries: RecallSummaryItem[]
  items: RecallItem[]
  stats: { total: number; got_it: number; shaky: number; forgot: number } | null
  created_at: Date
  completed_at: Date | null
}

function formatCoveredMaterial(pages: SessionPageEntry[]): string {
  return pages
    .map((page) => {
      const concepts = page.key_concepts.length ? `Concepts: ${page.key_concepts.join(', ')}` : null
      const summary = page.summary ? `Summary: ${page.summary}` : null
      return [`[${page.topic_title} — page ${page.page_number}] (topic_id: ${page.topic_id})`, concepts, summary]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n\n')
}

function normalizeContent(raw: any, pages: SessionPageEntry[]): RecallPageContent {
  const validTopicIds = new Set(pages.map((p) => p.topic_id))
  const summaries: RecallSummaryItem[] = Array.isArray(raw?.summaries)
    ? raw.summaries
        .map((s: any) => ({
          concept: String(s?.concept ?? '').trim(),
          summary: String(s?.summary ?? '').trim(),
        }))
        .filter((s: RecallSummaryItem) => s.concept && s.summary)
        .slice(0, 6)
    : []

  const items: RecallItem[] = Array.isArray(raw?.questions)
    ? raw.questions
        .map((q: any) => {
          const type = ['recall', 'connection', 'application'].includes(String(q?.type))
            ? (String(q.type) as RecallItemType)
            : 'recall'
          const topicId = String(q?.topic_id ?? '')
          return {
            id: crypto.randomUUID(),
            type,
            concept: String(q?.concept ?? '').trim(),
            topic_id: validTopicIds.has(topicId) ? topicId : null,
            prompt: String(q?.prompt ?? '').trim(),
            answer: String(q?.answer ?? '').trim(),
            rating: null,
          }
        })
        .filter((q: RecallItem) => q.prompt && q.answer)
        .slice(0, 7)
    : []

  return {
    headline: String(raw?.headline ?? '').trim() || 'Quick recall break',
    summaries,
    items,
  }
}

export async function generateRecallContent({
  courseTitle,
  pages,
}: {
  courseTitle: string
  pages: SessionPageEntry[]
}): Promise<RecallPageContent> {
  const multiTopic = new Set(pages.map((p) => p.topic_id)).size > 1

  const system = `You are TruLurn's recall-break designer.
A student pauses mid-study for a 3-5 minute active-recall break covering ONLY the material they just studied.
Retrieval strengthens memory far more than re-reading, so questions must force the student to produce the answer from memory — never recognize it.

Rules:
- Use ONLY the covered material supplied. Never test anything the student hasn't just seen.
- Questions are open recall prompts the student answers in their head, then self-checks. No multiple choice.
- "recall" questions target one concept: definitions in own words, why something works, what a step does.
- "connection" questions ask how two concepts JUST studied relate, differ, or feed each other.${multiTopic ? ' Prefer pairs from different topics.' : ''}
- "application" questions give a tiny concrete situation and ask the student to apply a just-learned idea.
- Answers are model answers: 1-3 sentences, concrete, the gist a correct response must contain.
- Wording stays friendly and direct. No exam tone, no "explain in detail".
- Each question carries the topic_id (verbatim from the material block) of its primary concept.
Return only valid JSON.`

  const user = `Course: ${courseTitle}

Material covered in this study stretch:
---
${formatCoveredMaterial(pages)}
---

Build the recall break. Return exactly:
{
  "headline": "one short encouraging line naming what the stretch covered",
  "summaries": [
    { "concept": "concept name", "summary": "1-2 sentence refresher in plain words" }
  ],
  "questions": [
    {
      "type": "recall|connection|application",
      "concept": "primary concept being tested",
      "topic_id": "topic_id of the primary concept",
      "prompt": "the question",
      "answer": "model answer, 1-3 sentences"
    }
  ]
}

Sizing:
- 3-5 summaries covering the most load-bearing concepts.
- 4-6 questions total: mostly "recall", at least one "connection" when two or more distinct concepts were covered, at most one "application".`

  const raw = await generateWithGemini({
    system,
    user,
    purpose: 'primary',
    responseMimeType: 'application/json',
  })

  return normalizeContent(parseGeminiJson<any>(raw), pages)
}

/**
 * Create a recall session document for the current study stretch.
 * Reuses an already-open recall session (e.g. the student refreshed mid-break).
 */
export async function createRecallSession({
  db,
  session,
  courseTitle,
  trigger,
}: {
  db: Db
  session: StudySessionDoc
  courseTitle: string
  trigger: RecallSessionDoc['trigger']
}): Promise<RecallSessionDoc> {
  const collection = db.collection<RecallSessionDoc>('recallSessions')

  const existing = await collection.findOne({
    user_id: session.user_id,
    study_session_id: session._id,
    status: 'open',
  })
  if (existing) return existing

  const pages = pagesSinceLastBreak(session)
  if (!pages.length) {
    throw new Error('Nothing new to recall yet — study a little more first.')
  }

  const content = await generateRecallContent({ courseTitle, pages })
  if (!content.items.length) {
    throw new Error('Could not build recall questions for this stretch.')
  }

  const doc: RecallSessionDoc = {
    _id: crypto.randomUUID(),
    user_id: session.user_id,
    course_id: session.course_id,
    study_session_id: session._id,
    status: 'open',
    trigger,
    headline: content.headline,
    summaries: content.summaries,
    items: content.items,
    stats: null,
    created_at: new Date(),
    completed_at: null,
  }
  await collection.insertOne(doc)
  return doc
}

/**
 * Record self-ratings for a completed recall break and propagate per-topic
 * recall stats (consumed by the knowledge graph and the personalization engine).
 */
export async function completeRecallSession({
  db,
  recallSessionId,
  userId,
  ratings,
}: {
  db: Db
  recallSessionId: string
  userId: string
  ratings: Record<string, RecallRating>
}): Promise<RecallSessionDoc | null> {
  const collection = db.collection<RecallSessionDoc>('recallSessions')
  const session = await collection.findOne({ _id: recallSessionId as any, user_id: userId })
  if (!session) return null

  const now = new Date()
  const validRatings: RecallRating[] = ['got_it', 'shaky', 'forgot']
  const items = session.items.map((item) => ({
    ...item,
    rating: validRatings.includes(ratings[item.id] as RecallRating)
      ? (ratings[item.id] as RecallRating)
      : item.rating ?? null,
  }))

  const stats = {
    total: items.length,
    got_it: items.filter((i) => i.rating === 'got_it').length,
    shaky: items.filter((i) => i.rating === 'shaky').length,
    forgot: items.filter((i) => i.rating === 'forgot').length,
  }

  await collection.updateOne(
    { _id: session._id },
    { $set: { items, stats, status: 'completed', completed_at: now } },
  )

  // Per-topic recall stats: hits strengthen a node, misses flag it for attention.
  const byTopic = new Map<string, { attempts: number; hits: number; misses: number }>()
  for (const item of items) {
    if (!item.topic_id || !item.rating) continue
    const entry = byTopic.get(item.topic_id) ?? { attempts: 0, hits: 0, misses: 0 }
    entry.attempts += 1
    if (item.rating === 'got_it') entry.hits += 1
    if (item.rating === 'forgot') entry.misses += 1
    byTopic.set(item.topic_id, entry)
  }

  await Promise.all(
    [...byTopic.entries()].map(([topicId, entry]) =>
      db.collection('topics').updateOne(
        { _id: topicId as any, course_id: session.course_id },
        {
          $inc: {
            'recall_stats.attempts': entry.attempts,
            'recall_stats.hits': entry.hits,
            'recall_stats.misses': entry.misses,
          },
          $set: { 'recall_stats.last_recall_at': now, updated_at: now },
        },
      ),
    ),
  )

  return { ...session, items, stats, status: 'completed', completed_at: now }
}
