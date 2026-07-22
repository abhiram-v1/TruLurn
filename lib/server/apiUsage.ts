import type { Db } from 'mongodb'
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export const API_USAGE_LIMITS = {
  course_builds: {
    label: 'Course builds',
    description: 'New AI-generated curricula',
    dailyLimit: 3,
  },
  lesson_generations: {
    label: 'Lesson generations',
    description: 'New lesson pages and lesson rewrites',
    dailyLimit: 40,
  },
  tutor_messages: {
    label: 'Tutor messages',
    description: 'AI tutor and doubt-chat replies',
    dailyLimit: 80,
  },
  quiz_actions: {
    label: 'Quiz actions',
    description: 'Generated questions and evaluated answers',
    dailyLimit: 100,
  },
  learning_tools: {
    label: 'Learning tools',
    description: 'Goal enhancement, previews, recall, and personalization',
    dailyLimit: 60,
  },
} as const

export type ApiUsageBucket = keyof typeof API_USAGE_LIMITS

type UsageCounter = {
  _id: string
  user_id: string
  bucket: ApiUsageBucket
  date_key: string
  count: number
  limit: number
  created_at: Date
  updated_at: Date
  expires_at: Date
}

type BurstCounter = {
  _id: string
  user_id: string
  scope: string
  window_start: Date
  count: number
  limit: number
  created_at: Date
  updated_at: Date
  expires_at: Date
}

const BURST_LIMIT = 15
const BURST_WINDOW_MS = 60_000

export class ApiUsageLimitError extends Error {
  readonly code = 'RATE_LIMITED'
  readonly status = 429

  constructor(
    message: string,
    readonly retryAfterSeconds: number,
    readonly limit: number,
    readonly remaining: number,
  ) {
    super(message)
    this.name = 'ApiUsageLimitError'
  }
}

function utcDateKey(now: Date): string {
  return now.toISOString().slice(0, 10)
}

function nextUtcDay(now: Date): Date {
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  ))
}

function duplicateKey(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 11000)
}

async function reserveDailyUsage(
  db: Db,
  userId: string,
  bucket: ApiUsageBucket,
  now: Date,
): Promise<{ limit: number; remaining: number; resetAt: Date }> {
  const config = API_USAGE_LIMITS[bucket]
  const dateKey = utcDateKey(now)
  const resetAt = nextUtcDay(now)
  const id = `${dateKey}:${userId}:${bucket}`
  const collection = db.collection<UsageCounter>('apiUsageDaily')

  const updated = await collection.updateOne(
    { _id: id, count: { $lt: config.dailyLimit } },
    {
      $inc: { count: 1 },
      $set: { updated_at: now, limit: config.dailyLimit },
    },
  )

  if (updated.matchedCount === 1) {
    const counter = await collection.findOne({ _id: id }, { projection: { count: 1 } })
    const count = Math.max(1, Number(counter?.count ?? 1))
    return { limit: config.dailyLimit, remaining: Math.max(0, config.dailyLimit - count), resetAt }
  }

  try {
    await collection.insertOne({
      _id: id,
      user_id: userId,
      bucket,
      date_key: dateKey,
      count: 1,
      limit: config.dailyLimit,
      created_at: now,
      updated_at: now,
      expires_at: new Date(resetAt.getTime() + 35 * 24 * 60 * 60 * 1000),
    })
    return { limit: config.dailyLimit, remaining: config.dailyLimit - 1, resetAt }
  } catch (error) {
    if (!duplicateKey(error)) throw error
    throw new ApiUsageLimitError(
      `${config.label} daily limit reached. Your allowance resets at 00:00 UTC.`,
      Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000)),
      config.dailyLimit,
      0,
    )
  }
}

async function reserveBurst(db: Db, userId: string, scope: string, now: Date): Promise<void> {
  const windowStartMs = Math.floor(now.getTime() / BURST_WINDOW_MS) * BURST_WINDOW_MS
  const windowStart = new Date(windowStartMs)
  const expiresAt = new Date(windowStartMs + BURST_WINDOW_MS * 2)
  const id = `${windowStartMs}:${userId}:${scope}`
  const collection = db.collection<BurstCounter>('apiRateWindows')

  const updated = await collection.updateOne(
    { _id: id, count: { $lt: BURST_LIMIT } },
    { $inc: { count: 1 }, $set: { updated_at: now, limit: BURST_LIMIT } },
  )

  if (updated.matchedCount === 1) return

  try {
    await collection.insertOne({
      _id: id,
      user_id: userId,
      scope,
      window_start: windowStart,
      count: 1,
      limit: BURST_LIMIT,
      created_at: now,
      updated_at: now,
      expires_at: expiresAt,
    })
  } catch (error) {
    if (!duplicateKey(error)) throw error
    const retryAfterSeconds = Math.max(1, Math.ceil((windowStartMs + BURST_WINDOW_MS - now.getTime()) / 1000))
    throw new ApiUsageLimitError(
      'Too many AI requests at once. Wait a moment and try again.',
      retryAfterSeconds,
      BURST_LIMIT,
      0,
    )
  }
}

export async function consumeApiUsage({
  userId,
  bucket,
  scope = 'ai',
  db,
}: {
  userId: string
  bucket: ApiUsageBucket
  scope?: string
  db?: Db
}) {
  const database = db ?? await getDb()
  const now = new Date()
  await reserveBurst(database, userId, scope, now)
  return reserveDailyUsage(database, userId, bucket, now)
}

export async function getApiUsageSummary(userId: string, db?: Db) {
  const database = db ?? await getDb()
  const now = new Date()
  const dateKey = utcDateKey(now)
  const rows = await database.collection<UsageCounter>('apiUsageDaily')
    .find({ user_id: userId, date_key: dateKey })
    .project({ bucket: 1, count: 1 })
    .toArray()
  const counts = new Map(rows.map((row) => [row.bucket, Math.max(0, Number(row.count ?? 0))]))

  return {
    period: 'daily' as const,
    resetAt: nextUtcDay(now).toISOString(),
    items: (Object.entries(API_USAGE_LIMITS) as Array<[ApiUsageBucket, typeof API_USAGE_LIMITS[ApiUsageBucket]]>)
      .map(([bucket, config]) => {
        const used = counts.get(bucket) ?? 0
        return {
          bucket,
          label: config.label,
          description: config.description,
          used,
          limit: config.dailyLimit,
          remaining: Math.max(0, config.dailyLimit - used),
        }
      }),
  }
}

export function apiUsageErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof ApiUsageLimitError)) return null
  return NextResponse.json(
    {
      error: error.message,
      code: error.code,
      limit: error.limit,
      remaining: error.remaining,
      retryAfterSeconds: error.retryAfterSeconds,
    },
    {
      status: error.status,
      headers: {
        'Cache-Control': 'no-store',
        'Retry-After': String(error.retryAfterSeconds),
      },
    },
  )
}
