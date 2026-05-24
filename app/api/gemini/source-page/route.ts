import { NextResponse } from 'next/server'
import { generateWithGemini } from '@/lib/ai/gemini/client'
import { parseGeminiJson } from '@/lib/ai/gemini/json'
import { sourceLearningPageSkill } from '@/lib/ai/skills'

type SourcePageRequest = {
  topicTitle?: string
  pageNumber?: number
  sourceText?: string
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SourcePageRequest

    if (!body.topicTitle?.trim()) {
      return NextResponse.json({ error: 'topicTitle is required.' }, { status: 400 })
    }

    if (!body.sourceText?.trim()) {
      return NextResponse.json({ error: 'sourceText is required.' }, { status: 400 })
    }

    const prompt = sourceLearningPageSkill({
      topicTitle: body.topicTitle.trim(),
      pageNumber: body.pageNumber ?? 1,
      sourceText: body.sourceText.trim(),
    })

    const text = await generateWithGemini(prompt)
    const page = parseGeminiJson<unknown>(text)

    return NextResponse.json({ page })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Gemini source page error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
