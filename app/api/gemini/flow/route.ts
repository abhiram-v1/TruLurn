import { NextResponse } from 'next/server'
import { generateWithGemini } from '@/lib/ai/gemini/client'
import { parseGeminiJson } from '@/lib/ai/gemini/json'
import { flowTrackerSkill } from '@/lib/ai/skills'

export async function POST(request: Request) {
  try {
    const evidence = (await request.json()) as unknown
    const prompt = flowTrackerSkill(evidence)
    const text = await generateWithGemini({ ...prompt, purpose: 'agent' })
    const flow = parseGeminiJson<unknown>(text)

    return NextResponse.json({ flow })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Gemini flow tracker error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
