import { NextResponse } from 'next/server'
import { generateAI, parseAIJson } from '@/lib/ai'
import { flowTrackerSkill } from '@/lib/ai/skills'

export async function POST(request: Request) {
  try {
    const evidence = (await request.json()) as unknown
    const prompt = flowTrackerSkill(evidence)
    const text = await generateAI({ feature: 'flow_tracking', ...prompt })
    const flow = parseAIJson<unknown>(text)

    return NextResponse.json({ flow })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown AI flow tracker error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
