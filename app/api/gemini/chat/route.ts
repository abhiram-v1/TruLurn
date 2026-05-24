import { NextResponse } from 'next/server'
import { generateWithGemini } from '@/lib/ai/gemini/client'
import { parseGeminiJson } from '@/lib/ai/gemini/json'
import { scopedChatSkill } from '@/lib/ai/skills'

type ChatRequest = {
  topicTitle?: string
  pageNumber?: number
  pageContent?: string
  userQuestion?: string
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatRequest

    if (!body.topicTitle?.trim()) {
      return NextResponse.json({ error: 'topicTitle is required.' }, { status: 400 })
    }

    if (!body.pageContent?.trim()) {
      return NextResponse.json({ error: 'pageContent is required.' }, { status: 400 })
    }

    if (!body.userQuestion?.trim()) {
      return NextResponse.json({ error: 'userQuestion is required.' }, { status: 400 })
    }

    const prompt = scopedChatSkill({
      topicTitle: body.topicTitle.trim(),
      pageNumber: body.pageNumber ?? 1,
      pageContent: body.pageContent.trim(),
      userQuestion: body.userQuestion.trim(),
    })

    const text = await generateWithGemini(prompt)
    const answer = parseGeminiJson<unknown>(text)

    return NextResponse.json({ answer })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Gemini chat error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
