export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'

export async function GET(
  request: Request,
  { params }: { params: { jobId: string } }
) {
  try {
    const userId = await getRequiredUserId()
    const db = (await getDb()) as any

    const job = await db.collection('generationJobs').findOne({
      _id: params.jobId,
      user_id: userId,
    })

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    return NextResponse.json(job)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    const status = message.includes('sign in') ? 401 : 500

    return NextResponse.json({ error: message }, { status })
  }
}

export async function POST(
  request: Request,
  { params }: { params: { jobId: string } },
) {
  try {
    const userId = await getRequiredUserId()
    const db = (await getDb()) as any
    const body = await request.json().catch(() => ({}))

    if (body.action !== 'retry') {
      return NextResponse.json({ error: 'Unsupported generation-job action.' }, { status: 400 })
    }

    const result = await db.collection('generationJobs').findOneAndUpdate(
      {
        _id: params.jobId,
        user_id: userId,
        status: 'failed',
      },
      {
        $set: {
          status: 'running',
          message: 'Resuming from the last completed stage...',
          updated_at: new Date(),
        },
        $unset: {
          error: '',
          error_code: '',
          worker_run_id: '',
          worker_lease_expires_at: '',
        },
      },
      { returnDocument: 'after' },
    )

    if (!result.value) {
      const job = await db.collection('generationJobs').findOne({
        _id: params.jobId,
        user_id: userId,
      })
      if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
      if (job.status === 'completed') {
        return NextResponse.json({ error: 'This course has already finished generating.' }, { status: 409 })
      }
      return NextResponse.json({ error: 'This generation job is already active.' }, { status: 409 })
    }

    return NextResponse.json(result.value)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not resume course generation.'
    const status = message.includes('sign in') ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
