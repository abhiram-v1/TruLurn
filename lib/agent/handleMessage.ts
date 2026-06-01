import type { Db } from 'mongodb'
import { detectActionIntent } from '@/lib/agent/classifyIntent'
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

  const intent = detectActionIntent(message)

  if (intent) {
    const result = await executeAction({
      db,
      intent,
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

  const result = await handleDoubt({
    db,
    userId,
    courseId,
    topicId,
    pageNumber,
    question: message,
    selectedContext,
  })

  return {
    id: result.id,
    content: result.content,
    uiAction: null,
  }
}
