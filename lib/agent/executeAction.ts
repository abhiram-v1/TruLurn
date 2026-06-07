import crypto from 'crypto'
import type { Db } from 'mongodb'
import { generateWithGemini } from '@/lib/ai/gemini/client'
import { firstTeachableDescendant, isTeachableTopic, nextRecommendedTeachableTopic, previousTeachableTopic, sortTracciaTopics } from '@/lib/traccia/sequence'
import { resolveStyleFromMessage, STYLE_CATALOG } from '@/lib/ai/skills/lessonStyle'
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
  const topics = await db.collection('topics')
    .find({ course_id: courseId })
    .sort({ sequence_index: 1, position: 1 })
    .toArray()
  return sortTracciaTopics(topics as any)
}

// Uses the model to fuzzy-match the student's message against the available
// topic list. Handles abbreviations, synonyms, and partial names gracefully.
async function resolveTopicFromMessage(
  topics: any[],
  message: string,
): Promise<{ _id: string; title: string } | null> {
  const teachableTopics = topics.filter((topic) => isTeachableTopic(topic as any))
  if (!teachableTopics.length) return null

  // Fast path: exact case-insensitive substring match — avoids the Gemini call
  // for the common case where the student uses the exact topic title.
  const lower = message.toLowerCase()
  const exact = teachableTopics.find((t) => lower.includes(String(t.title).toLowerCase()))
  if (exact) return { _id: String(exact._id), title: String(exact.title) }

  const numbered = teachableTopics.map((t, i) => `${i + 1}. ${t.title}`).join('\n')

  try {
    const raw = await generateWithGemini({
      system: `You match a student's message to the most relevant topic from a numbered list.
Return ONLY the topic number (e.g. "3"). Return "0" if no topic is a reasonable match.
No explanation. No punctuation.`,
      user: `Topics:\n${numbered}\n\nStudent message: "${message}"\n\nTopic number:`,
      purpose: 'agent',
      responseMimeType: 'text/plain',
    })

    const num = parseInt(raw.trim(), 10)
    if (!num || num < 1 || num > teachableTopics.length) return null

    const matched = teachableTopics[num - 1]
    return { _id: String(matched._id), title: matched.title }
  } catch {
    return null
  }
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
      const next = nextRecommendedTeachableTopic(topics as any, topicId)
      if (!next) {
        return { content: "You're on the last topic in this course — nothing to move on to.", uiAction: null }
      }
      return {
        content: `Moving you to **${next.title}**.`,
        uiAction: { action: 'next_topic', topicId: String(next._id), topicTitle: String(next.title ?? 'Next topic') },
      }
    }

    case 'prev_topic': {
      const topics = await getOrderedTopics(db, courseId)
      const prev = previousTeachableTopic(topics as any, topicId)
      if (!prev) {
        return { content: "This is the first topic — nothing to go back to.", uiAction: null }
      }
      return {
        content: `Taking you back to **${prev.title}**.`,
        uiAction: { action: 'prev_topic', topicId: String(prev._id), topicTitle: String(prev.title ?? 'Previous topic') },
      }
    }

    case 'go_to_topic': {
      const topics = await getOrderedTopics(db, courseId)
      const resolved = await resolveTopicFromMessage(topics, message)
      const matchedTopic = resolved
        ? topics.find((topic) => String(topic._id) === resolved._id)
        : null
      const descendant = matchedTopic && !isTeachableTopic(matchedTopic as any)
        ? firstTeachableDescendant(topics as any, String(matchedTopic._id))
        : null
      const match = descendant
        ? { _id: String(descendant._id), title: String(descendant.title) }
        : resolved
      if (!match) {
        return {
          content: "I couldn't identify which topic you mean. Try using a bit more of the topic name.",
          uiAction: null,
        }
      }
      return {
        content: `Navigating to **${match.title}**.`,
        uiAction: { action: 'navigate_to_topic', topicId: match._id, topicTitle: match.title },
      }
    }

    case 'explain_again': {
      return {
        content: 'Regenerating this page with a different angle and framing.',
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
      const match = await resolveTopicFromMessage(topics, message)
      if (match) {
        return {
          content: `Opening the quiz for **${match.title}**.`,
          uiAction: { action: 'open_quiz', topicId: match._id },
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

    case 'change_lesson_style': {
      const newStyle = await resolveStyleFromMessage(message)
      if (!newStyle) {
        return {
          content: "I couldn't figure out which style you're after. Try describing what you want — for example: \"make lessons more mathematical\", \"use more code examples\", or \"keep it conceptual and practical\".",
          uiAction: null,
        }
      }
      await db.collection('courses').updateOne(
        { _id: courseId as any, user_id: input.userId },
        { $set: { learning_style: newStyle, updated_at: new Date() } },
      )
      const styleName = STYLE_CATALOG[newStyle]?.name ?? newStyle
      return {
        content: `Done — lessons from here on will use the **${styleName}** style. Pages already generated won't change, but every new page will follow the updated approach.`,
        uiAction: null,
      }
    }

    case 'skip_current': {
      const [course, topics, existingPages] = await Promise.all([
        db.collection('courses').findOne({ _id: courseId as any, user_id: input.userId }),
        getOrderedTopics(db, courseId),
        db.collection('pages').countDocuments({ course_id: courseId, topic_id: topicId }),
      ])
      const policy = String(course?.progression_policy ?? course?.learning_control_mode ?? 'balanced')

      if (policy === 'guided' || policy === 'strict') {
        return {
          content: 'I can move you forward after there is some evidence from the current topic. Try the quiz, or ask me what still matters here and I will keep it short.',
          uiAction: null,
        }
      }

      const next = nextRecommendedTeachableTopic(topics as any, topicId)
      if (!next) {
        return { content: "You're already at the end of the sequence.", uiAction: null }
      }

      await db.collection('learningEvents').insertOne({
        _id: crypto.randomUUID() as any,
        course_id: courseId,
        topic_id: topicId,
        user_id: input.userId,
        event_type: 'agent_skip_requested',
        page_number: pageNumber,
        progression_policy: policy,
        existing_pages: existingPages,
        message: message.slice(0, 500),
        created_at: new Date(),
      })

      await db.collection('topics').updateOne(
        { _id: topicId as any, course_id: courseId },
        {
          $set: {
            content_state: 'pruned_by_student',
            pruned_planned_pages: true,
            estimated_pages: Math.max(existingPages, pageNumber, 1),
            updated_at: new Date(),
          },
        },
      )

      return {
        content: `Got it. I will not treat that as mastery, but I can trim the remaining generated pages here and move you to **${next.title}**.`,
        uiAction: { action: 'next_topic', topicId: String(next._id), topicTitle: String(next.title ?? 'Next topic') },
      }
    }
  }
}
