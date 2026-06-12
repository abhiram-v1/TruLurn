import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import {
  getRecallBreakSettings,
  MAX_BREAK_DURATION_MINUTES,
  MIN_BREAK_DURATION_MINUTES,
  setRecallBreakSettings,
  type RecallBreakMode,
} from '@/lib/recall/session'

// GET  /api/settings/recall — current schedule and break duration
// PUT  /api/settings/recall — update either or both settings

export async function GET() {
  try {
    const userId = await getRequiredUserId()
    const db = await getDb()
    const settings = await getRecallBreakSettings(db, userId)
    return NextResponse.json(settings)
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
    const hasMode = body.mode !== undefined
    const hasDuration = body.durationMinutes !== undefined
    const mode = hasMode ? String(body.mode) as RecallBreakMode : undefined
    const durationMinutes = hasDuration ? Number(body.durationMinutes) : undefined

    if (!hasMode && !hasDuration) {
      return NextResponse.json({ error: 'No recall setting was provided.' }, { status: 400 })
    }
    if (mode && !['auto', '30m', '60m', 'off'].includes(mode)) {
      return NextResponse.json({ error: 'Invalid recall break mode.' }, { status: 400 })
    }
    if (
      hasDuration
      && (!Number.isFinite(durationMinutes)
        || durationMinutes! < MIN_BREAK_DURATION_MINUTES
        || durationMinutes! > MAX_BREAK_DURATION_MINUTES)
    ) {
      return NextResponse.json(
        { error: `Break duration must be between ${MIN_BREAK_DURATION_MINUTES} and ${MAX_BREAK_DURATION_MINUTES} minutes.` },
        { status: 400 },
      )
    }

    const db = await getDb()
    await setRecallBreakSettings(db, userId, { mode, durationMinutes })
    const settings = await getRecallBreakSettings(db, userId)
    return NextResponse.json({ ok: true, ...settings })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save recall settings.'
    const status = message.includes('sign in') ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
