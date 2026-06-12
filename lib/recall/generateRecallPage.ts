import crypto from 'crypto'
import type { Db } from 'mongodb'
import { generateAI, parseAIJson } from '@/lib/ai'
import type { SessionPageEntry, StudySessionDoc } from '@/lib/recall/session'
import { pagesSinceLastBreak } from '@/lib/recall/session'

// ── Recall page generation ────────────────────────────────────────────────────
// Turns the material covered in the current study stretch into lightweight
// memory cues. Students recall privately; this flow never reveals answers or
// treats a prompt as mastery evidence.

export type RecallItemType = 'recall' | 'connection' | 'application'

export type RecallItem = {
  id: string
  type: RecallItemType
  concept: string
  /** Primary source location for tagging and direct lesson navigation. */
  topic_id: string | null
  topic_title: string | null
  page_number: number | null
  prompt: string
  /** Retained so older stored recall sessions remain readable. */
  answer?: string | null
  rating?: 'got_it' | 'shaky' | 'forgot' | null
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
  reviewed_item_ids?: string[]
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
  const fallbackPage = pages.at(-1) ?? null

  const items: RecallItem[] = Array.isArray(raw?.questions)
    ? raw.questions
        .map((q: any) => {
          const type = ['recall', 'connection', 'application'].includes(String(q?.type))
            ? (String(q.type) as RecallItemType)
            : 'recall'
          const requestedTopicId = String(q?.topic_id ?? '')
          const topicId = validTopicIds.has(requestedTopicId)
            ? requestedTopicId
            : fallbackPage?.topic_id ?? null
          const sourcePages = pages.filter((page) => page.topic_id === topicId)
          const requestedPageNumber = Number(q?.page_number)
          const sourcePage = sourcePages.find((page) => page.page_number === requestedPageNumber)
            ?? sourcePages.at(-1)
            ?? fallbackPage
          return {
            id: crypto.randomUUID(),
            type,
            concept: String(q?.concept ?? '').trim(),
            topic_id: sourcePage?.topic_id ?? topicId,
            topic_title: sourcePage?.topic_title ?? null,
            page_number: sourcePage?.page_number ?? null,
            prompt: String(q?.prompt ?? '').trim(),
          }
        })
        .filter((q: RecallItem) => q.prompt && q.topic_id)
        .slice(0, 7)
    : []

  return {
    headline: String(raw?.headline ?? '').trim() || 'Quick recall break',
    summaries: [],
    items,
  }
}

export async function generateRecallContent({
  courseTitle,
  pages,
  audienceDirective,
}: {
  courseTitle: string
  pages: SessionPageEntry[]
  /** Who the learner is (buildAudienceDirective) — keeps cues framed for them. */
  audienceDirective?: string
}): Promise<RecallPageContent> {
  const multiTopic = new Set(pages.map((p) => p.topic_id)).size > 1

  const system = `You are TruLurn's recall-prompt designer.
A learner pauses mid-study for a short active-recall break covering ONLY the material they just studied.
These are private memory cues, not quiz questions. The learner reflects mentally and is never asked to submit or reveal an answer.
${audienceDirective ? `\n${audienceDirective}\n` : ''}

Rules:
- Use ONLY the covered material supplied. Never test anything the student hasn't just seen.
- Write open recall prompts only. No multiple choice, answer choices, model answers, scoring, or requests to submit a response.
- "recall" questions target one concept: definitions in own words, why something works, what a step does.
- "connection" questions ask how two concepts JUST studied relate, differ, or feed each other.${multiTopic ? ' Prefer pairs from different topics.' : ''}
- "application" questions give a tiny concrete situation and ask the learner to mentally apply a just-learned idea.
- Wording stays friendly and direct. No exam tone, no "explain in detail".
- Each question carries the topic_id and page_number (verbatim from the material block) of its primary source.
Return only valid JSON.`

  const user = `Course: ${courseTitle}

Material covered in this study stretch:
---
${formatCoveredMaterial(pages)}
---

Build the recall break. Return exactly:
{
  "headline": "one short encouraging line naming what the stretch covered",
  "questions": [
    {
      "type": "recall|connection|application",
      "concept": "primary concept being recalled",
      "topic_id": "topic_id of the primary concept",
      "page_number": 1,
      "prompt": "the memory cue"
    }
  ]
}

Sizing:
- 4-6 questions total: mostly "recall", at least one "connection" when two or more distinct concepts were covered, at most one "application".`

  const raw = await generateAI({
    feature: 'recall_page_generation',
    system,
    user,
    responseMimeType: 'application/json',
  })

  return normalizeContent(parseAIJson<any>(raw), pages)
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
  audienceDirective,
}: {
  db: Db
  session: StudySessionDoc
  courseTitle: string
  trigger: RecallSessionDoc['trigger']
  audienceDirective?: string
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

  const content = await generateRecallContent({ courseTitle, pages, audienceDirective })
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

/** Complete a prompt-only recall break without creating mastery evidence. */
export async function completeRecallSession({
  db,
  recallSessionId,
  userId,
  reviewedItemIds,
}: {
  db: Db
  recallSessionId: string
  userId: string
  reviewedItemIds: string[]
}): Promise<RecallSessionDoc | null> {
  const collection = db.collection<RecallSessionDoc>('recallSessions')
  const session = await collection.findOne({ _id: recallSessionId as any, user_id: userId })
  if (!session) return null

  const now = new Date()
  const validItemIds = new Set(session.items.map((item) => item.id))
  const reviewed = [...new Set(reviewedItemIds)].filter((itemId) => validItemIds.has(itemId))

  await collection.updateOne(
    { _id: session._id },
    {
      $set: {
        reviewed_item_ids: reviewed,
        stats: null,
        status: 'completed',
        completed_at: now,
      },
    },
  )

  return {
    ...session,
    reviewed_item_ids: reviewed,
    stats: null,
    status: 'completed',
    completed_at: now,
  }
}
