import { NextResponse } from 'next/server'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { getApiUsageSummary } from '@/lib/server/apiUsage'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const userId = await getRequiredUserId()
    const usage = await getApiUsageSummary(userId)
    return NextResponse.json(usage, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load usage.'
    const status = message.toLowerCase().includes('sign in') ? 401 : 500
    return NextResponse.json({ error: status === 401 ? message : 'Could not load usage.' }, { status })
  }
}
