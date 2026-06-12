import { NextResponse } from 'next/server'
import { generateAI, parseAIJson } from '@/lib/ai'
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

    const text = await generateAI({ feature: 'source_learning_page', ...prompt })
    const page = parseAIJson<unknown>(text)

    return NextResponse.json({ page })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown AI source page error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
