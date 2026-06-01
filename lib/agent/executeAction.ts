import type { Db } from 'mongodb'
import type { ActionIntent, UIAction } from '@/types/agent'

type ExecuteActionInput = {
  db: Db
  intent: ActionIntent
  message: string
  courseId: string
  topicId: string
  pageNumber: number
  userId: string
}

type ExecuteActionResult = {
  content: string
  uiAction: UIAction | null
}

async function getOrderedTopics(db: Db, courseId: string) {
  return db.collection('topics').find({ course_id: courseId }).sort({ position: 1 }).toArray()
}

export async function executeAction(input: ExecuteActionInput): Promise<ExecuteActionResult> {
  const { db, intent, message, courseId, topicId, pageNumber } = input

  switch (intent) {
    case 'quiz_request': {
      return {
        content: 'Opening the quiz for this topic.',
        uiAction: { action: 'open_quiz', topicId },
      }
    }

    case 'next_topic': {
      const topics = await getOrderedTopics(db, courseId)
      const idx = topics.findIndex((t) => String(t._id) === topicId)
      const next = topics[idx + 1]
      if (!next) {
        return { content: "You're on the last topic in this course — nothing to move on to.", uiAction: null }
      }
      return {
        content: `Moving you to **${next.title}**.`,
        uiAction: { action: 'next_topic', topicId: String(next._id), topicTitle: next.title },
      }
    }

    case 'prev_topic': {
      const topics = await getOrderedTopics(db, courseId)
      const idx = topics.findIndex((t) => String(t._id) === topicId)
      const prev = topics[idx - 1]
      if (!prev) {
        return { content: "This is the first topic — nothing to go back to.", uiAction: null }
      }
      return {
        content: `Taking you back to **${prev.title}**.`,
        uiAction: { action: 'prev_topic', topicId: String(prev._id), topicTitle: prev.title },
      }
    }

    case 'go_to_topic': {
      const topics = await getOrderedTopics(db, courseId)
      const m = message.toLowerCase()
      const match = topics.find((t) => m.includes(t.title.toLowerCase())) ?? null
      if (!match) {
        return {
          content: "I couldn't find that topic in your course. Try a more exact title.",
          uiAction: null,
        }
      }
      return {
        content: `Navigating to **${match.title}**.`,
        uiAction: { action: 'navigate_to_topic', topicId: String(match._id), topicTitle: match.title },
      }
    }

    case 'explain_again': {
      return {
        content: 'Regenerating this page with a fresh angle and different framing.',
        uiAction: { action: 'regenerate_page', approach: 'explain_again' },
      }
    }

    case 'go_deeper': {
      return {
        content: 'Regenerating with more depth and detail.',
        uiAction: { action: 'regenerate_page', approach: 'go_deeper' },
      }
    }

    case 'simplify': {
      return {
        content: 'Generating a simplified version of this page.',
        uiAction: { action: 'regenerate_page', approach: 'simplify' },
      }
    }

    case 'show_example': {
      return {
        content: 'Regenerating with a focus on concrete examples.',
        uiAction: { action: 'regenerate_page', approach: 'show_example' },
      }
    }

    case 'custom_quiz': {
      const topics = await getOrderedTopics(db, courseId)
      const m = message.toLowerCase()
      const match = topics.find((t) => m.includes(t.title.toLowerCase())) ?? null
      if (match) {
        return {
          content: `Opening the quiz for **${match.title}**.`,
          uiAction: { action: 'open_quiz', topicId: String(match._id) },
        }
      }
      return {
        content: 'Opening the quiz for this topic.',
        uiAction: { action: 'open_quiz', topicId },
      }
    }

    case 'generate_page': {
      const lastPage = await db
        .collection('pages')
        .find({ course_id: courseId, topic_id: topicId })
        .sort({ page_number: -1 })
        .limit(1)
        .toArray()
      const targetPageNumber = lastPage.length > 0 ? lastPage[0].page_number + 1 : pageNumber + 1
      const instruction = message.trim()
      return {
        content: `Generating a custom page: "${instruction.slice(0, 100)}${instruction.length > 100 ? '...' : ''}"`,
        uiAction: { action: 'generate_custom_page', instruction, targetPageNumber },
      }
    }
  }
}
