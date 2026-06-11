import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { getRecallBreakMode, setRecallBreakMode, type RecallBreakMode } from '@/lib/recall/session'

// GET  /api/settings/recall — current recall-break mode for the signed-in user
// PUT  /api/settings/recall — update it ({ mode: "auto" | "30m" | "60m" | "off" })

export async function GET() {
  try {
    const userId = await getRequiredUserId()
    const db = await getDb()
    const mode = await getRecallBreakMode(db, userId)
    return NextResponse.json({ mode })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load recall settings.'
    const status = message.includes('sign in') ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export async function PUT(request: Request) {
  try {
    const userId = await getRequiredUserId()
    const body = await request.json()
    const mode = String(body.mode ?? '') as RecallBreakMode

    if (!['auto', '30m', '60m', 'off'].includes(mode)) {
      return NextResponse.json({ error: 'Invalid recall break mode.' }, { status: 400 })
    }

    const db = await getDb()
    await setRecallBreakMode(db, userId, mode)
    return NextResponse.json({ ok: true, mode })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save recall settings.'
    const status = message.includes('sign in') ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
