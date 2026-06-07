import crypto from 'crypto'
import type { Db } from 'mongodb'
import { generateWithGemini } from '@/lib/ai/gemini/client'
import { classifyQuestion, type DoubtQuestionType } from '@/lib/doubts/classifyQuestion'
import { getConceptMap, invalidateConceptMapCache } from '@/lib/doubts/conceptMap'
import { buildDoubtPrompt, type TopicStateSnapshot } from '@/lib/doubts/context'
import { extractForwardRef, storeForwardRef } from '@/lib/agent/forwardRefs'
import {
  computeGlobalPagePosition,
  findTopicPageByGlobalNumber,
  plannedPageCount,
  sortCourseTopics,
} from '@/lib/course-pages/globalPageNumbers'
import {
  buildAgentWorkspaceContext,
  planAgentContext,
  selectAdaptiveHistory,
} from '@/lib/agent/context'
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
  preClassifiedType?: DoubtQuestionType
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

  const orderedTopics = sortCourseTopics(topics, branches)
  const branch = branches.find((item) => item.branch_key === topic.branch_id || String(item._id) === String(topic.branch_id))
  const branchTopics = orderedTopics.filter((item) => String(item.branch_id) === String(topic.branch_id))
  const globalPage = computeGlobalPagePosition({
    topics: orderedTopics,
    branches,
    topicId,
    pageNumber,
  })

  const totalPages = plannedPageCount(topic, pageNumber)

  return {
    course,
    topic,
    orderedTopics,
    branches,
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
      globalPageNumber: globalPage.globalPageNumber,
      globalPageTotal: globalPage.globalPageTotal,
      isLastPage: totalPages > 1 && pageNumber >= totalPages,
      pageFocus: pageSummary?.focus ?? page.focus ?? null,
      content: page.content,
    },
  }
}

function extractCoursePageReferences(question: string) {
  const refs = new Set<number>()
  const patterns = [
    /\b(?:course|global|standard)\s+page\s*#?\s*(\d{1,4})\b/gi,
    /\bpage\s+number\s*#?\s*(\d{1,4})\b/gi,
    /\bpage\s+(\d{1,4})\b/gi,
    /\bp(?:age)?\s*#\s*(\d{1,4})\b/gi,
  ]

  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(question)) !== null) {
      refs.add(Number(match[1]))
    }
  }

  return [...refs].filter((value) => Number.isFinite(value) && value > 0).slice(0, 3)
}

function compactForPrompt(value: unknown, max = 1700) {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}...` : clean
}

async function fetchExplicitPageReferences({
  db,
  courseId,
  question,
  orderedTopics,
  branches,
}: {
  db: Db
  courseId: string
  question: string
  orderedTopics: any[]
  branches: any[]
}) {
  const refs = extractCoursePageReferences(question)
  if (!refs.length) return ''

  const blocks: string[] = ['EXPLICIT COURSE PAGE REFERENCES:']

  for (const globalPageNumber of refs) {
    const target = findTopicPageByGlobalNumber({ topics: orderedTopics, branches, globalPageNumber })

    if (!target) {
      blocks.push(`- Course page ${globalPageNumber}: no planned page exists for this course number.`)
      continue
    }

    const [topic, page, summary] = await Promise.all([
      db.collection('topics').findOne({ _id: target.topicId as any, course_id: courseId }),
      db.collection('pages').findOne({
        course_id: courseId,
        topic_id: target.topicId,
        page_number: target.pageNumber,
      }),
      db.collection('pageSummaries').findOne({
        course_id: courseId,
        topic_id: target.topicId,
        page_number: target.pageNumber,
      }),
    ])

    if (!page) {
      blocks.push(
        `- Course page ${globalPageNumber}: planned as ${topic?.title ?? target.topicId}, topic page ${target.pageNumber}, but it has not been generated yet.`,
      )
      continue
    }

    blocks.push([
      `- Course page ${globalPageNumber}: ${topic?.title ?? target.topicId}, topic page ${target.pageNumber}`,
      summary?.focus ? `Focus: ${summary.focus}` : null,
      summary?.summary ? `Summary: ${summary.summary}` : null,
      `Content excerpt: ${compactForPrompt(page.content)}`,
    ].filter(Boolean).join('\n'))
  }

  return blocks.join('\n\n')
}

// Cheap always-on fetch — gives the agent live topic state, mastery level,
// and last quiz result without waiting for keyword-triggered workspace context.
async function fetchTopicState(
  db: Db,
  courseId: string,
  topicId: string,
  userId: string,
): Promise<TopicStateSnapshot> {
  const [topic, lastSession] = await Promise.all([
    db.collection('topics').findOne(
      { _id: topicId as any, course_id: courseId },
      { projection: { state: 1, understanding_level: 1, needs_review: 1, review_gaps: 1, misconception: 1 } },
    ),
    db.collection('examSessions').findOne(
      { course_id: courseId, topic_id: topicId, user_id: userId, status: 'completed' },
      { sort: { completed_at: -1 }, projection: { summary: 1 } },
    ),
  ])

  const examSummary = lastSession?.summary ?? null

  return {
    state: topic?.state ?? null,
    understanding_level: typeof topic?.understanding_level === 'number' ? topic.understanding_level : null,
    needs_review: topic?.needs_review ?? null,
    review_gaps: Array.isArray(topic?.review_gaps) ? topic.review_gaps : null,
    misconception: topic?.misconception ?? null,
    lastExam: examSummary
      ? {
          passed: Boolean(examSummary.passed),
          overall_level: typeof examSummary.overall_level === 'number' ? examSummary.overall_level : undefined,
          strong_concepts: Array.isArray(examSummary.strong_concepts) ? examSummary.strong_concepts : undefined,
          review_concepts: Array.isArray(examSummary.review_concepts) ? examSummary.review_concepts : undefined,
          student_summary: typeof examSummary.student_summary === 'string' ? examSummary.student_summary : undefined,
        }
      : null,
  }
}

async function fetchRecentHistory(db: Db, courseId: string, userId: string) {
  const messages = await db.collection('doubtMessages')
    .find({ course_id: courseId, user_id: userId })
    .sort({ created_at: -1 })
    .limit(20)
    .project({ role: 1, content: 1, topic_id: 1, page_number: 1, global_page_number: 1 })
    .toArray()

  const topicIds = [...new Set(messages.map((message) => String(message.topic_id)))]
  const topics = await db.collection('topics')
    .find({ course_id: courseId, _id: { $in: topicIds as any[] } })
    .project({ title: 1 })
    .toArray()
  const topicTitleById = new Map(topics.map((topic) => [String(topic._id), topic.title]))

  const mapped = messages.reverse().map((message) => ({
    role: message.role as 'user' | 'assistant',
    content: String(message.content),
    topic_title: topicTitleById.get(String(message.topic_id)) ?? null,
    page_number: message.page_number ?? null,
    global_page_number: message.global_page_number ?? null,
  }))

  return selectAdaptiveHistory(mapped, 1800).messages
}

async function generateAnswer({
  db,
  type,
  question,
  selectedContext,
  workspaceContext,
  courseId,
  userId,
  topicId,
  currentPage,
  recentHistory,
  conceptMap,
  topicState,
  relevantPages,
  memory,
}: {
  db: Db
  type: DoubtQuestionType
  question: string
  selectedContext?: string | null
  workspaceContext?: string | null
  courseId: string
  userId: string
  topicId: string
  currentPage: Awaited<ReturnType<typeof fetchCurrentPosition>>['promptPage']
  recentHistory: Awaited<ReturnType<typeof fetchRecentHistory>>
  conceptMap: string[]
  topicState: TopicStateSnapshot
  relevantPages: RelevantPage[]
  memory: CourseMemoryContext
}) {
  const prompt = buildDoubtPrompt({
    type,
    question,
    selectedContext,
    workspaceContext,
    currentPage,
    recentHistory,
    conceptMap,
    topicState,
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
      workspaceContext,
      courseId,
      userId,
      topicId,
      currentPage,
      recentHistory,
      conceptMap,
      topicState,
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
  globalPageNumber,
  role,
  content,
}: {
  db: Db
  courseId: string
  userId: string
  topicId: string
  pageNumber: number
  globalPageNumber?: number
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
    global_page_number: globalPageNumber ?? null,
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
  const contextPlan = planAgentContext(question, selectedContext)

  // Skip concept map for general_knowledge — not injected into that prompt type.
  // Saves 3 DB reads (topics + topicSummaries + pageSummaries) per GK question.
  const needsConceptMap = input.preClassifiedType !== 'general_knowledge'

  const [position, recentHistory, conceptMap, topicState] = await Promise.all([
    fetchCurrentPosition(input.db, input.courseId, input.topicId, input.pageNumber, input.userId),
    fetchRecentHistory(input.db, input.courseId, input.userId),
    needsConceptMap
      ? getConceptMap(input.db, input.courseId)
      : Promise.resolve([] as string[]),
    fetchTopicState(input.db, input.courseId, input.topicId, input.userId),
  ])

  // Use pre-classified type from the combined intent classifier if available —
  // this skips a full AI round-trip (~700-1000 ms).
  const typePromise = input.preClassifiedType
    ? Promise.resolve(input.preClassifiedType)
    : classifyQuestion(questionWithContext, position.page.content, conceptMap)

  // Parallelize workspace context reads alongside question type resolution
  // instead of running them sequentially after classification.
  const [type, workspaceContext, explicitPageContext] = await Promise.all([
    typePromise,
    buildAgentWorkspaceContext({
      db: input.db,
      courseId: input.courseId,
      userId: input.userId,
      currentTopicId: input.topicId,
      plan: contextPlan,
    }),
    fetchExplicitPageReferences({
      db: input.db,
      courseId: input.courseId,
      question,
      orderedTopics: position.orderedTopics,
      branches: position.branches,
    }),
  ])

  const combinedWorkspaceContext = [workspaceContext, explicitPageContext]
    .filter((block) => block && block.trim())
    .join('\n\n')

  // general_knowledge: model answers from its own knowledge — no retrieval at all.
  // current_page: page content is already in the prompt — no cross-topic retrieval.
  // course_specific: full vector retrieval for cross-topic context.
  const shouldRetrieveMemory = type === 'course_specific' || contextPlan.needsSemanticMemory
  const memory = shouldRetrieveMemory
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

  const relevantPages = shouldRetrieveMemory ? memory.pages : []

  // Fire-and-forget — don't block answer generation on the DB write.
  storeMessage({
    db: input.db,
    courseId: input.courseId,
    userId: input.userId,
    topicId: input.topicId,
    pageNumber: input.pageNumber,
    globalPageNumber: position.promptPage.globalPageNumber,
    role: 'user',
    content: question,
  }).catch((err) => console.warn('Failed to store user message.', err))

  const rawAnswer = await generateAnswer({
    db: input.db,
    type,
    question,
    selectedContext,
    workspaceContext: combinedWorkspaceContext,
    courseId: input.courseId,
    userId: input.userId,
    topicId: input.topicId,
    currentPage: position.promptPage,
    recentHistory,
    conceptMap,
    topicState,
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
    globalPageNumber: position.promptPage.globalPageNumber,
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
    contextPlan,
  }
}
