import crypto from 'crypto'
import type { Db } from 'mongodb'

// ── Smart Recall Break engine ─────────────────────────────────────────────────
// Tracks what a student actually covers during a continuous study session —
// pages opened, concepts introduced, questions answered — and decides when an
// in-session recall break is due. Distinct from lib/review/schedule.ts, which
// handles day-scale spaced repetition BETWEEN sessions; this handles minute-scale
// retrieval DURING a session, while the material is still in working memory.

export type RecallBreakMode = 'auto' | '30m' | '60m' | 'off'
export type RecallBreakSettings = {
  mode: RecallBreakMode
  durationMinutes: number
}

export const DEFAULT_BREAK_DURATION_MINUTES = 10
export const MIN_BREAK_DURATION_MINUTES = 5
export const MAX_BREAK_DURATION_MINUTES = 45

export const RECALL_BREAK_MODES: Array<{ id: RecallBreakMode; name: string; description: string }> = [
  { id: 'auto', name: 'Auto', description: 'TruLurn watches your pace and concept load, and calls a break when retrieval will help most.' },
  { id: '30m', name: 'Every 30 minutes', description: 'A recall break after every 30 minutes of active study.' },
  { id: '60m', name: 'Every 60 minutes', description: 'A recall break after every 60 minutes of active study.' },
  { id: 'off', name: 'Off', description: 'Never interrupt. Recall stays available from the lesson toolbar.' },
]

// A session goes stale after this much inactivity — the next activity starts a new one.
const SESSION_IDLE_MS = 30 * 60 * 1000
// Heartbeats arrive every ~60s; cap the credited gap so a backgrounded tab
// doesn't count as study time.
const MAX_CREDIT_MS = 3 * 60 * 1000

export type SessionPageEntry = {
  topic_id: string
  topic_title: string
  page_number: number
  key_concepts: string[]
  summary: string | null
  first_viewed_at: Date
}

export type StudySessionDoc = {
  _id: string
  user_id: string
  course_id: string
  status: 'active' | 'ended'
  started_at: Date
  last_activity_at: Date
  /** Accumulated active study milliseconds (heartbeat-credited). */
  active_ms: number
  /** Active ms at the moment the last recall break completed. */
  active_ms_at_last_break: number
  last_break_at: Date | null
  snoozed_until: Date | null
  pages: SessionPageEntry[]
  /** Index into `pages` marking where the last completed break left off. */
  pages_at_last_break: number
  questions_answered: number
  questions_at_last_break: number
  breaks_completed: number
  created_at: Date
  updated_at: Date
}

export type TrackEvent = {
  type: 'heartbeat' | 'page_view' | 'question_answered'
  topicId?: string
  topicTitle?: string
  pageNumber?: number
  keyConcepts?: string[]
  summary?: string | null
}

export type BreakDecision = {
  due: boolean
  reason: string | null
  /** Material accumulated since the last break — what a recall page would cover. */
  newPages: number
  newConcepts: number
  minutesSinceBreak: number
}

function uniqueConcepts(pages: SessionPageEntry[]): string[] {
  const seen = new Set<string>()
  for (const page of pages) {
    for (const concept of page.key_concepts) {
      const clean = concept.trim()
      if (clean) seen.add(clean.toLowerCase())
    }
  }
  return [...seen]
}

/**
 * Decide whether a recall break is due for this session under the given mode.
 *
 * Fixed modes (30m/60m) fire on active study time since the last break.
 * Auto mode uses a cognitive-load score: each new concept adds working-memory
 * pressure, each new page adds context switches, and elapsed time adds decay.
 * The break fires when retrieval is likely to beat continued input — enough
 * new material has stacked up, or enough time has passed that the early
 * material is about to slip.
 */
export function evaluateBreakDue(session: StudySessionDoc, mode: RecallBreakMode, now = new Date()): BreakDecision {
  const newPagesList = session.pages.slice(session.pages_at_last_break)
  const newPages = newPagesList.length
  const newConcepts = uniqueConcepts(newPagesList).length
  const msSinceBreak = Math.max(0, session.active_ms - session.active_ms_at_last_break)
  const minutesSinceBreak = msSinceBreak / 60_000

  const base: BreakDecision = { due: false, reason: null, newPages, newConcepts, minutesSinceBreak }

  if (mode === 'off') return base
  if (session.snoozed_until && session.snoozed_until > now) return base
  // Nothing meaningful to recall yet — never interrupt for an empty break.
  if (newPages < 1 || (newPages < 2 && newConcepts < 3)) return base

  if (mode === '30m' || mode === '60m') {
    const threshold = mode === '30m' ? 30 : 60
    if (minutesSinceBreak >= threshold) {
      return { ...base, due: true, reason: `${Math.round(minutesSinceBreak)} minutes of active study` }
    }
    return base
  }

  // ── Auto mode ──
  // load = concepts (×1.5) + pages (×4) + minutes (×1.0)
  // Trigger when load is high AND a minimum spacing has passed, or when the
  // session has simply run long regardless of load.
  const load = newConcepts * 1.5 + newPages * 4 + minutesSinceBreak
  const MIN_SPACING_MINUTES = 18
  const HARD_CAP_MINUTES = 50
  const LOAD_THRESHOLD = 55

  if (minutesSinceBreak >= HARD_CAP_MINUTES) {
    return { ...base, due: true, reason: `${Math.round(minutesSinceBreak)} minutes without a recall pause` }
  }
  if (minutesSinceBreak >= MIN_SPACING_MINUTES && load >= LOAD_THRESHOLD) {
    return {
      ...base,
      due: true,
      reason: `${newConcepts} new concept${newConcepts === 1 ? '' : 's'} across ${newPages} page${newPages === 1 ? '' : 's'}`,
    }
  }
  return base
}

/**
 * Record a study activity event, creating or resuming the active session.
 * Returns the up-to-date session.
 */
export async function trackStudyActivity({
  db,
  userId,
  courseId,
  event,
  now = new Date(),
}: {
  db: Db
  userId: string
  courseId: string
  event: TrackEvent
  now?: Date
}): Promise<StudySessionDoc> {
  const collection = db.collection<StudySessionDoc>('studySessions')

  let session = await collection.findOne({
    user_id: userId,
    course_id: courseId,
    status: 'active',
  })

  // Stale session → close it and start fresh.
  if (session && now.getTime() - new Date(session.last_activity_at).getTime() > SESSION_IDLE_MS) {
    await collection.updateOne(
      { _id: session._id },
      { $set: { status: 'ended', updated_at: now } },
    )
    session = null
  }

  if (!session) {
    const fresh: StudySessionDoc = {
      _id: crypto.randomUUID(),
      user_id: userId,
      course_id: courseId,
      status: 'active',
      started_at: now,
      last_activity_at: now,
      active_ms: 0,
      active_ms_at_last_break: 0,
      last_break_at: null,
      snoozed_until: null,
      pages: [],
      pages_at_last_break: 0,
      questions_answered: 0,
      questions_at_last_break: 0,
      breaks_completed: 0,
      created_at: now,
      updated_at: now,
    }
    await collection.insertOne(fresh)
    session = fresh
  }

  // Credit active time since the previous activity, capped so backgrounded
  // tabs and walk-aways don't inflate the study clock.
  const gap = Math.max(0, now.getTime() - new Date(session.last_activity_at).getTime())
  const credit = Math.min(gap, MAX_CREDIT_MS)

  const update: Record<string, unknown> = {
    last_activity_at: now,
    updated_at: now,
  }
  const inc: Record<string, number> = { active_ms: credit }

  if (event.type === 'question_answered') {
    inc.questions_answered = 1
  }

  if (event.type === 'page_view' && event.topicId && Number.isFinite(event.pageNumber)) {
    const alreadyTracked = session.pages.some(
      (p) => p.topic_id === event.topicId && p.page_number === event.pageNumber,
    )
    if (!alreadyTracked) {
      const entry: SessionPageEntry = {
        topic_id: String(event.topicId),
        topic_title: String(event.topicTitle ?? 'Topic'),
        page_number: Number(event.pageNumber),
        key_concepts: Array.isArray(event.keyConcepts)
          ? event.keyConcepts.map((c) => String(c)).filter(Boolean).slice(0, 12)
          : [],
        summary: event.summary ? String(event.summary) : null,
        first_viewed_at: now,
      }
      await collection.updateOne(
        { _id: session._id },
        { $set: update, $inc: inc, $push: { pages: entry } },
      )
      const updated = await collection.findOne({ _id: session._id })
      return updated ?? session
    }
  }

  await collection.updateOne({ _id: session._id }, { $set: update, $inc: inc })
  return {
    ...session,
    last_activity_at: now,
    active_ms: session.active_ms + credit,
    questions_answered: session.questions_answered + (event.type === 'question_answered' ? 1 : 0),
  }
}

/** Snooze the pending break prompt for `minutes` of wall-clock time. */
export async function snoozeBreak({
  db,
  sessionId,
  userId,
  minutes = 5,
  now = new Date(),
}: {
  db: Db
  sessionId: string
  userId: string
  minutes?: number
  now?: Date
}): Promise<void> {
  await db.collection('studySessions').updateOne(
    { _id: sessionId as any, user_id: userId },
    { $set: { snoozed_until: new Date(now.getTime() + minutes * 60_000), updated_at: now } },
  )
}

/**
 * Mark a recall break completed on the session: advance the "since last break"
 * watermarks so the next break only covers new material.
 */
export async function markBreakCompleted({
  db,
  sessionId,
  userId,
  now = new Date(),
}: {
  db: Db
  sessionId: string
  userId: string
  now?: Date
}): Promise<void> {
  const session = await db.collection<StudySessionDoc>('studySessions').findOne({
    _id: sessionId as any,
    user_id: userId,
  })
  if (!session) return

  await db.collection('studySessions').updateOne(
    { _id: session._id as any },
    {
      $set: {
        last_break_at: now,
        active_ms_at_last_break: session.active_ms,
        pages_at_last_break: session.pages.length,
        questions_at_last_break: session.questions_answered,
        snoozed_until: null,
        updated_at: now,
      },
      $inc: { breaks_completed: 1 },
    },
  )
}

/** Pages covered since the last completed break — the recall page's raw material. */
export function pagesSinceLastBreak(session: StudySessionDoc): SessionPageEntry[] {
  return session.pages.slice(session.pages_at_last_break)
}

// ── User setting ──────────────────────────────────────────────────────────────

export async function getRecallBreakMode(db: Db, userId: string): Promise<RecallBreakMode> {
  return (await getRecallBreakSettings(db, userId)).mode
}

export async function getRecallBreakSettings(db: Db, userId: string): Promise<RecallBreakSettings> {
  const settings = await db.collection('userSettings').findOne(
    { _id: userId as any },
    { projection: { recall_break_mode: 1, recall_break_duration_minutes: 1 } },
  )
  const mode = String(settings?.recall_break_mode ?? 'auto')
  const normalizedMode = (['auto', '30m', '60m', 'off'] as const).includes(mode as RecallBreakMode)
    ? (mode as RecallBreakMode)
    : 'auto'
  const rawDuration = Number(settings?.recall_break_duration_minutes ?? DEFAULT_BREAK_DURATION_MINUTES)
  const durationMinutes = Number.isFinite(rawDuration)
    ? Math.min(MAX_BREAK_DURATION_MINUTES, Math.max(MIN_BREAK_DURATION_MINUTES, Math.round(rawDuration)))
    : DEFAULT_BREAK_DURATION_MINUTES

  return { mode: normalizedMode, durationMinutes }
}

export async function setRecallBreakMode(db: Db, userId: string, mode: RecallBreakMode): Promise<void> {
  await setRecallBreakSettings(db, userId, { mode })
}

export async function setRecallBreakSettings(
  db: Db,
  userId: string,
  settings: Partial<RecallBreakSettings>,
): Promise<void> {
  const now = new Date()
  const update: Record<string, unknown> = { updated_at: now }
  if (settings.mode) update.recall_break_mode = settings.mode
  if (Number.isFinite(settings.durationMinutes)) {
    update.recall_break_duration_minutes = Math.min(
      MAX_BREAK_DURATION_MINUTES,
      Math.max(MIN_BREAK_DURATION_MINUTES, Math.round(Number(settings.durationMinutes))),
    )
  }

  await db.collection('userSettings').updateOne(
    { _id: userId as any },
    {
      $set: update,
      $setOnInsert: { created_at: now },
    },
    { upsert: true },
  )
}
