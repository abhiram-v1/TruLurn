export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { enforceSourceGroundedCurriculum } from '@/lib/course-generation/sourceCurriculumIntegrity'

// Save the (optionally edited) curriculum the user reviewed and approve it, so the
// generation worker resumes from the curriculum-preview gate and builds the rest of
// the course (atlas → traccia → pages) from this exact structure.
//
// POST body: { curriculum?: <full curriculum object> }
// If `curriculum` is omitted, the existing AI-built curriculum is approved as-is.
export async function POST(
  request: Request,
  { params }: { params: { jobId: string } },
) {
  try {
    const userId = await getRequiredUserId()
    const db = (await getDb()) as any
    const body = await request.json().catch(() => ({}))

    const job = await db.collection('generationJobs').findOne({
      _id: params.jobId,
      user_id: userId,
    })
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    if (job.status === 'completed' || job.status === 'failed') {
      return NextResponse.json({ error: 'This course has already finished generating.' }, { status: 409 })
    }

    const edited = body?.curriculum
    const candidate = edited && Array.isArray(edited.branches) && edited.branches.length > 0
      ? edited
      : job.curriculum
    const curriculum = job.input?.mode === 'source_grounded'
      ? enforceSourceGroundedCurriculum(candidate, {
          sourceText: job.input?.sourceText,
          sourceProfile: job.input?.sourceProfile,
        })
      : candidate

    const update: Record<string, unknown> = {
      curriculum_approved: true,
      curriculum,
      status: 'running',
      stage: 'building_atlas',
      stage_label: 'Building Atlas',
      message: 'Curriculum approved. Building the rest of your course...',
      updated_at: new Date(),
    }

    // Only overwrite the curriculum when the client sent an edited one, and only
    // when it's structurally valid (has at least one branch). Otherwise approve
    // the existing AI-built curriculum untouched.
    await db.collection('generationJobs').updateOne(
      { _id: params.jobId, user_id: userId },
      {
        $set: update,
        $unset: { worker_run_id: '', worker_lease_expires_at: '' },
      },
    )

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not approve curriculum.'
    const code = (error as any)?.code
    const status = message.includes('sign in') ? 401 : code === 'SOURCE_CURRICULUM_INTEGRITY' ? 400 : 500
    return NextResponse.json({
      error: message,
      code: code ?? null,
      issues: Array.isArray((error as any)?.issues) ? (error as any).issues : undefined,
    }, { status })
  }
}
