import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { generateWithGemini } from '@/lib/ai/gemini/client'
import { parseGeminiJson } from '@/lib/ai/gemini/json'
import { scopedChatSkill } from '@/lib/ai/skills'
import crypto from 'crypto'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { topicId, pageNumber, question } = body

    if (!topicId || pageNumber === undefined || !question?.trim()) {
      return NextResponse.json({ error: 'Missing required chat parameters.' }, { status: 400 })
    }

    const db = await getDb()

    // 1. Fetch Topic
    const topic = await db.collection('topics').findOne({ _id: topicId as any })
    if (!topic) {
      return NextResponse.json({ error: 'Topic not found.' }, { status: 404 })
    }

    // 2. Fetch Page
    const page = await db.collection('pages').findOne({
      topic_id: topicId,
      page_number: Number(pageNumber),
    })

    // 3. Save User Message
    const userMsgId = crypto.randomUUID()
    await db.collection('doubtMessages').insertOne({
      _id: userMsgId as any,
      topic_id: topicId,
      page_number: Number(pageNumber),
      role: 'user',
      content: question.trim(),
      created_at: new Date(),
    })

    // 4. Generate AI response
    const prompt = scopedChatSkill({
      topicTitle: topic.title,
      pageNumber: Number(pageNumber),
      pageContent: page?.content || 'No page content available.',
      userQuestion: question.trim(),
    })

    const geminiText = await generateWithGemini(prompt)
    const parsed = parseGeminiJson<any>(geminiText)

    const answer = parsed.answer || 'I am sorry, I could not formulate a scoped response.'

    // 5. Save Assistant Message
    const assistantMsgId = crypto.randomUUID()
    await db.collection('doubtMessages').insertOne({
      _id: assistantMsgId as any,
      topic_id: topicId,
      page_number: Number(pageNumber),
      role: 'assistant',
      content: answer,
      created_at: new Date(),
    })

    return NextResponse.json({
      id: assistantMsgId,
      content: answer,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown doubt chat error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
