import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import {
  getHistoricalMigrationStatus,
  processHistoricalMigrationBatch,
  retryFailedHistoricalEmbeddings,
} from '@/lib/vector/migration'
import { ensureLexicalSearchIndexes, ensureVectorSearchIndexes } from '@/lib/vector/indexes'

export async function GET() {
  try {
    const db = await getDb()
    const userId = await getRequiredUserId()
    return NextResponse.json({
      ok: true,
      migration: await getHistoricalMigrationStatus(db, userId),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown migration status error'
    return NextResponse.json(
      { error: message },
      { status: message.includes('sign in') ? 401 : 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as {
      batchSize?: number
      retryFailed?: boolean
    }
    const db = await getDb()
    const userId = await getRequiredUserId()

    await Promise.all([
      ensureVectorSearchIndexes(db),
      ensureLexicalSearchIndexes(db),
    ])
    if (body.retryFailed) {
      await retryFailedHistoricalEmbeddings(db, userId)
    }

    const result = await processHistoricalMigrationBatch(
      db,
      userId,
      Number(body.batchSize ?? 25),
    )
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown migration error'
    const status = message.includes('sign in')
      ? 401
      : message.includes('already running')
        ? 409
        : 500
    return NextResponse.json({ error: message }, { status })
  }
}
