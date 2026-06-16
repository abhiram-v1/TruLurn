import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { deleteCourseWithLineage } from '@/lib/sources/deletion'
import { normalizeTeachingPersona, TEACHING_PERSONAS } from '@/lib/personas'

// ── PATCH — update mutable course settings ───────────────────────────────────
// Accepted fields: code_language (string | null), teaching_persona,
// source_coverage_preference ('complete' | 'smart' | 'core' | null — feeds the
// adaptive source fidelity policy; null returns to style-derived coverage)
export async function PATCH(
  request: Request,
  { params }: { params: { courseId: string } },
) {
  try {
    const courseId = params.courseId?.trim()
    if (!courseId) {
      return NextResponse.json({ error: 'courseId is required.' }, { status: 400 })
    }

    const userId = await getRequiredUserId()
    const db = await getDb()

    const course = await db.collection('courses').findOne({
      _id: courseId as any,
      user_id: userId,
    })
    if (!course) {
      return NextResponse.json({ error: 'Course not found.' }, { status: 404 })
    }

    const body = await request.json() as Record<string, unknown>

    // Whitelist of fields the client is allowed to update
    const ALLOWED: Record<string, (v: unknown) => boolean> = {
      code_language: (v) => v === null || typeof v === 'string',
      teaching_persona: (v) => v === 'immersive_builder' || v === 'investigator',
      source_coverage_preference: (v) => v === null || v === 'complete' || v === 'smart' || v === 'core',
    }

    const $set: Record<string, unknown> = { updated_at: new Date() }
    for (const [key, validate] of Object.entries(ALLOWED)) {
      if (key in body) {
        if (!validate(body[key])) {
          return NextResponse.json({ error: `Invalid value for ${key}.` }, { status: 400 })
        }
        $set[key] = body[key]
      }
    }
    if ('teaching_persona' in body) {
      const persona = normalizeTeachingPersona(body.teaching_persona)
      $set.teaching_persona = persona
      $set.teaching_persona_version = TEACHING_PERSONAS[persona].version
    }

    if (Object.keys($set).length === 1) {
      // Only updated_at — nothing useful was sent
      return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 })
    }

    await db.collection('courses').updateOne(
      { _id: courseId as any, user_id: userId },
      { $set },
    )

    return NextResponse.json({ updated: true, fields: Object.keys($set).filter((k) => k !== 'updated_at') })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    const status = message.includes('sign in') ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { courseId: string } },
) {
  try {
    const courseId = params.courseId?.trim()

    if (!courseId) {
      return NextResponse.json({ error: 'courseId is required.' }, { status: 400 })
    }

    const userId = await getRequiredUserId()
    const db = await getDb()
    const course = await db.collection('courses').findOne({
      _id: courseId as any,
      user_id: userId,
    })

    if (!course) {
      return NextResponse.json({ error: 'Course not found.' }, { status: 404 })
    }

    const result = await deleteCourseWithLineage(db, { userId, courseId })
    return NextResponse.json(result, { status: result.deleted ? 200 : 500 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown course deletion error'
    const status = message.includes('sign in') ? 401 : 500

    return NextResponse.json({ error: message }, { status })
  }
}
