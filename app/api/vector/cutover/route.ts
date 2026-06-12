import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import {
  getRetrievalCutoverConfig,
  getRetrievalParityReport,
  RETRIEVAL_CUTOVER_WORKFLOWS,
  updateRetrievalCutoverConfig,
  type RetrievalCutoverMode,
  type RetrievalCutoverWorkflow,
} from '@/lib/vector/cutover'
import { getHistoricalMigrationStatus } from '@/lib/vector/migration'

type CutoverUpdateBody = {
  seed?: string
  workflows?: Partial<Record<
    RetrievalCutoverWorkflow,
    { mode?: RetrievalCutoverMode; rolloutPercent?: number }
  >>
}

async function statusPayload() {
  const db = await getDb()
  const userId = await getRequiredUserId()
  const [config, migration, parity] = await Promise.all([
    getRetrievalCutoverConfig(db, userId),
    getHistoricalMigrationStatus(db, userId),
    getRetrievalParityReport(db, userId),
  ])
  return { db, userId, config, migration, parity }
}

export async function GET() {
  try {
    const { config, migration, parity } = await statusPayload()
    return NextResponse.json({ ok: true, config, migration, parity })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown cutover status error'
    return NextResponse.json(
      { error: message },
      { status: message.includes('sign in') ? 401 : 500 },
    )
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as CutoverUpdateBody
    const { db, userId, migration, parity } = await statusPayload()
    const requestedV2 = RETRIEVAL_CUTOVER_WORKFLOWS.some(
      (workflow) => body.workflows?.[workflow]?.mode === 'v2',
    )
    if (requestedV2 && !migration.completed) {
      return NextResponse.json({
        error: 'Historical V2 embedding migration must complete before a workflow can be fully cut over.',
        migration,
      }, { status: 409 })
    }

    const config = await updateRetrievalCutoverConfig(db, userId, body)
    return NextResponse.json({ ok: true, config, migration, parity })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown cutover update error'
    const status = message.includes('sign in')
      ? 401
      : message.startsWith('Invalid cutover mode')
        ? 400
        : 500
    return NextResponse.json({ error: message }, { status })
  }
}
