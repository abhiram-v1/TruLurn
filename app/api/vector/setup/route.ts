import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { ensureLexicalSearchIndexes, ensureVectorSearchIndexes } from '@/lib/vector/indexes'
import { processHistoricalMigrationBatch } from '@/lib/vector/migration'

export async function POST() {
  try {
    const db = await getDb()
    const userId = await getRequiredUserId()

    const [vectorIndexes, lexicalIndexes] = await Promise.all([
      ensureVectorSearchIndexes(db),
      ensureLexicalSearchIndexes(db),
    ])
    const migration = await processHistoricalMigrationBatch(db, userId, 50)

    return NextResponse.json({
      ok: true,
      indexes: {
        vector: vectorIndexes,
        lexical: lexicalIndexes,
      },
      migration,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown vector setup error'
    const status = message.includes('sign in') ? 401 : 500

    return NextResponse.json({ error: message }, { status })
  }
}
