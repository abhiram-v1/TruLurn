import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { ensureVectorSearchIndexes } from '@/lib/vector/indexes'
import { backfillUserEmbeddings } from '@/lib/vector/retrieval'

export async function POST() {
  try {
    const db = await getDb()
    const userId = await getRequiredUserId()

    const indexes = await ensureVectorSearchIndexes(db)
    const backfilled = await backfillUserEmbeddings(db, userId)

    return NextResponse.json({
      ok: true,
      indexes,
      backfilled,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown vector setup error'
    const status = message.includes('sign in') ? 401 : 500

    return NextResponse.json({ error: message }, { status })
  }
}
