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
