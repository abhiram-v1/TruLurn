import crypto from 'crypto'
import type { Db } from 'mongodb'
import { generateWithGemini } from '@/lib/ai/gemini/client'
import { classifyQuestion, type DoubtQuestionType } from '@/lib/doubts/classifyQuestion'
import { getConceptMap } from '@/lib/doubts/conceptMap'
import { buildDoubtPrompt } from '@/lib/doubts/context'
import { extractForwardRef, storeForwardRef } from '@/lib/agent/forwardRefs'
import {
  embedDoubtMessageById,
  findRelevantPages,
  retrieveCourseMemory,
  type CourseMemoryContext,
  type RelevantPage,
} from '@/lib/vector/retrieval'

type HandleDoubtInput = {
  db: Db
  userId: string
  courseId: string
  topicId: string
  pageNumber: number
  question: string
  selectedContext?: string | null
}

async function fetchCurrentPosition(
  db: Db,
  courseId: string,
  topicId: string,
  pageNumber: number,
  userId: string,
) {
  const [course, topic, page, pageSummary, branches, topics] = await Promise.all([
    db.collection('courses').findOne({ _id: courseId as any, user_id: userId }),
    db.collection('topics').findOne({ _id: topicId as any, course_id: courseId }),
    db.collection('pages').findOne({ course_id: courseId, topic_id: topicId, page_number: pageNumber }),
    db.collection('pageSummaries').findOne({ course_id: courseId, topic_id: topicId, page_number: pageNumber }),
    db.collection('branches').find({ course_id: courseId }).sort({ created_at: 1 }).toArray(),
    db.collection('topics').find({ course_id: courseId }).sort({ position: 1 }).toArray(),
  ])

  if (!course) throw new Error('Course not found.')
  if (!topic) throw new Error('Topic not found.')
  if (!page) throw new Error('Page not found.')

  const branch = branches.find((item) => item.branch_key === topic.branch_id || String(item._id) === String(topic.branch_id))
  const branchTopics = topics.filter((item) => item.branch_id === topic.branch_id)

  const totalPages = Math.max(1, Number(topic.estimated_pages ?? page.page_number ?? 1))

  return {
    course,
    topic,
    page,
    promptPage: {
      courseTitle: course.title,
      branchTitle: branch?.title ?? topic.section ?? 'Course branch',
      branchPosition: Math.max(1, branches.findIndex((item) => String(item._id) === String(branch?._id)) + 1),
      branchTotal: Math.max(1, branches.length),
      topicTitle: topic.title,
      topicPosition: Math.max(1, branchTopics.findIndex((item) => String(item._id) === topicId) + 1),
      topicTotal: Math.max(1, branchTopics.length),
      pageNumber,
      totalPages,
      isLastPage: totalPages > 1 && pageNumber >= totalPages,
      pageFocus: pageSummary?.focus ?? page.focus ?? null,
      content: page.content,
    },
  }
}

async function fetchRecentHistory(db: Db, courseId: string, userId: string) {
  const messages = await db.collection('doubtMessages')
    .find({ course_id: courseId, user_id: userId })
    .sort({ created_at: -1 })
    .limit(6)
    .toArray()

  const topicIds = [...new Set(messages.map((message) => String(message.topic_id)))]
  const topics = await db.collection('topics')
    .find({ course_id: courseId, _id: { $in: topicIds as any[] } })
    .project({ title: 1 })
    .toArray()
  const topicTitleById = new Map(topics.map((topic) => [String(topic._id), topic.title]))

  return messages.reverse().map((message) => ({
    role: message.role as 'user' | 'assistant',
    content: String(message.content),
    topic_title: topicTitleById.get(String(message.topic_id)) ?? null,
    page_number: message.page_number ?? null,
  }))
}

async function generateAnswer({
  db,
  type,
  question,
  selectedContext,
  courseId,
  userId,
  topicId,
  currentPage,
  recentHistory,
  conceptMap,
  relevantPages,
  memory,
}: {
  db: Db
  type: DoubtQuestionType
  question: string
  selectedContext?: string | null
  courseId: string
  userId: string
  topicId: string
  currentPage: Awaited<ReturnType<typeof fetchCurrentPosition>>['promptPage']
  recentHistory: Awaited<ReturnType<typeof fetchRecentHistory>>
  conceptMap: string[]
  relevantPages: RelevantPage[]
  memory: CourseMemoryContext
}) {
  const prompt = buildDoubtPrompt({
    type,
    question,
    selectedContext,
    currentPage,
    recentHistory,
    conceptMap,
    relevantPages,
    relevantDoubts: memory.doubtMessages,
    relevantSources: memory.sourceChunks,
  })

  const geminiText = await generateWithGemini({
    ...prompt,
    purpose: 'agent',
    responseMimeType: 'text/plain',
  })
  const answer = geminiText.trim() || 'I am sorry, I could not formulate a scoped response.'

  // If the model signals it needs retrieval, retry with course-specific context
  if (answer.startsWith('NEEDS_RETRIEVAL:') && type !== 'course_specific') {
    const concept = answer.replace('NEEDS_RETRIEVAL:', '').trim() || question
    const retryPages = await findRelevantPages({
      db,
      query: concept,
      courseId,
      userId,
      excludeTopicId: topicId,
      limit: 2,
    })

    return generateAnswer({
      db,
      type: 'course_specific',
      question,
      selectedContext,
      courseId,
      userId,
      topicId,
      currentPage,
      recentHistory,
      conceptMap,
      relevantPages: retryPages,
      memory,
    })
  }

  return answer
}

async function storeMessage({
  db,
  courseId,
  userId,
  topicId,
  pageNumber,
  role,
  content,
}: {
  db: Db
  courseId: string
  userId: string
  topicId: string
  pageNumber: number
  role: 'user' | 'assistant'
  content: string
}) {
  const id = crypto.randomUUID()

  await db.collection('doubtMessages').insertOne({
    _id: id as any,
    course_id: courseId,
    user_id: userId,
    topic_id: topicId,
    page_number: pageNumber,
    role,
    content,
    created_at: new Date(),
  })

  embedDoubtMessageById(db, id).catch((error) => {
    console.warn('Failed to embed doubt message.', error)
  })

  return id
}

export async function handleDoubt(input: HandleDoubtInput) {
  const question = input.question.trim()
  const selectedContext = input.selectedContext?.trim()
  const questionWithContext = selectedContext
    ? `${question}\n\nSelected passage:\n${selectedContext}`
    : question

  const [position, recentHistory, conceptMap] = await Promise.all([
    fetchCurrentPosition(input.db, input.courseId, input.topicId, input.pageNumber, input.userId),
    fetchRecentHistory(input.db, input.courseId, input.userId),
    getConceptMap(input.db, input.courseId),
  ])

  const type = await classifyQuestion(questionWithContext, position.page.content, conceptMap)

  // general_knowledge: model answers from its own knowledge — no retrieval at all.
  // current_page: page content is already in the prompt — no cross-topic retrieval.
  // course_specific: full vector retrieval for cross-topic context.
  // Skipping retrieveCourseMemory for the first two types avoids 3 unnecessary
  // embedding API calls per message (each sub-function embeds even with limit=0).
  const memory = type === 'course_specific'
    ? await retrieveCourseMemory({
        db: input.db,
        query: questionWithContext,
        courseId: input.courseId,
        userId: input.userId,
        currentTopicId: input.topicId,
        pageLimit: 3,
        doubtLimit: 4,
        sourceLimit: 3,
      })
    : { pages: [], doubtMessages: [], sourceChunks: [] }

  const relevantPages = type === 'course_specific' ? memory.pages : []

  await storeMessage({
    db: input.db,
    courseId: input.courseId,
    userId: input.userId,
    topicId: input.topicId,
    pageNumber: input.pageNumber,
    role: 'user',
    content: question,
  })

  const rawAnswer = await generateAnswer({
    db: input.db,
    type,
    question,
    selectedContext,
    courseId: input.courseId,
    userId: input.userId,
    topicId: input.topicId,
    currentPage: position.promptPage,
    recentHistory,
    conceptMap,
    relevantPages,
    memory,
  })

  const { cleanResponse, ref } = extractForwardRef(rawAnswer)

  if (ref) {
    storeForwardRef(
      input.db,
      input.userId,
      input.courseId,
      question,
      ref.concept,
      ref.targetTopic,
      { topicId: input.topicId, pageNumber: input.pageNumber, topicTitle: position.topic.title },
    ).catch((err) => console.warn('Failed to store forward ref.', err))
  }

  const assistantId = await storeMessage({
    db: input.db,
    courseId: input.courseId,
    userId: input.userId,
    topicId: input.topicId,
    pageNumber: input.pageNumber,
    role: 'assistant',
    content: cleanResponse,
  })

  return {
    id: assistantId,
    content: cleanResponse,
    questionType: type,
    retrievedPages: relevantPages.map((page) => ({
      topicTitle: page.topic_title,
      pageNumber: page.page_number,
      score: page.score,
    })),
    retrievedMemory: {
      pages: memory.pages.length,
      doubts: memory.doubtMessages.length,
      sources: memory.sourceChunks.length,
    },
  }
}
