import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { getLegacyCleanupGate, retireLegacyVectorFields } from '@/lib/vector/cleanup'

export async function GET() {
  try {
    const db = await getDb()
    const userId = await getRequiredUserId()
    return NextResponse.json({
      ok: true,
      gate: await getLegacyCleanupGate(db, userId),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown cleanup status error'
    return NextResponse.json(
      { error: message },
      { status: message.includes('sign in') ? 401 : 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { confirmation?: string }
    if (body.confirmation !== 'RETIRE_LEGACY_VECTOR_FIELDS') {
      return NextResponse.json({
        error: 'Set confirmation to RETIRE_LEGACY_VECTOR_FIELDS.',
      }, { status: 400 })
    }

    const db = await getDb()
    const userId = await getRequiredUserId()
    return NextResponse.json({
      ok: true,
      result: await retireLegacyVectorFields(db, userId),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown cleanup error'
    const status = message.includes('sign in')
      ? 401
      : message.includes('blocked')
        ? 409
        : 500
    return NextResponse.json({ error: message }, { status })
  }
}
