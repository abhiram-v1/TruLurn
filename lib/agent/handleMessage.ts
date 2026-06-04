import type { Db } from 'mongodb'
import { classifyIntent } from '@/lib/agent/classifyIntent'
import { executeAction } from '@/lib/agent/executeAction'
import { handleDoubt } from '@/lib/doubts/handleDoubt'
import type { AgentMessage } from '@/types/agent'

type HandleMessageInput = {
  db: Db
  userId: string
  courseId: string
  topicId: string
  pageNumber: number
  message: string
  selectedContext?: string | null
}

export async function handleMessage(input: HandleMessageInput): Promise<AgentMessage> {
  const { db, userId, courseId, topicId, pageNumber, message, selectedContext } = input

  // Fetch the two context items needed for classification in parallel.
  const [page, lastAssistant] = await Promise.all([
    db.collection('pages').findOne(
      { course_id: courseId, topic_id: topicId, page_number: pageNumber },
      { projection: { focus: 1 } },
    ),
    db.collection('doubtMessages').findOne(
      { course_id: courseId, user_id: userId, role: 'assistant' },
      { sort: { created_at: -1 }, projection: { content: 1 } },
    ),
  ])

  // Combined classifier — returns either an action intent OR a doubt question
  // type, replacing two sequential AI calls with one.
  const classification = await classifyIntent(
    message,
    page?.focus ?? '',
    lastAssistant?.content ?? undefined,
  )

  if (classification.kind === 'action') {
    const result = await executeAction({
      db,
      intent: classification.intent,
      message,
      courseId,
      topicId,
      pageNumber,
      userId,
    })
    return {
      id: `action-${Date.now()}`,
      content: result.content,
      uiAction: result.uiAction,
    }
  }

  // Pass the pre-classified question type so handleDoubt skips its own
  // classifyQuestion AI call — that round-trip is already done above.
  const result = await handleDoubt({
    db,
    userId,
    courseId,
    topicId,
    pageNumber,
    question: message,
    selectedContext,
    preClassifiedType: classification.questionType,
  })

  return {
    id: result.id,
    content: result.content,
    uiAction: null,
  }
}
