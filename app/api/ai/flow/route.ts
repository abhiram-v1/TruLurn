import { NextResponse } from 'next/server'
import { generateAI, parseAIJson } from '@/lib/ai'
import { flowTrackerSkill } from '@/lib/ai/skills'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { apiUsageErrorResponse, consumeApiUsage } from '@/lib/server/apiUsage'

export async function POST(request: Request) {
  try {
    const userId = await getRequiredUserId()
    const evidence = (await request.json()) as unknown
    if (JSON.stringify(evidence).length > 20_000) {
      return NextResponse.json({ error: 'Evidence payload is too large.' }, { status: 413 })
    }
    await consumeApiUsage({ userId, bucket: 'learning_tools', scope: 'ai-tools' })
    const prompt = flowTrackerSkill(evidence)
    const text = await generateAI({ feature: 'flow_tracking', ...prompt })
    const flow = parseAIJson<unknown>(text)

    return NextResponse.json({ flow })
  } catch (error) {
    const limited = apiUsageErrorResponse(error)
    if (limited) return limited
    const message = error instanceof Error ? error.message : 'AI flow tracker failed.'
    const status = message.toLowerCase().includes('sign in') ? 401 : 500
    return NextResponse.json({ error: status === 401 ? message : 'AI flow tracker failed.' }, { status })
  }
}
