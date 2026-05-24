export const dynamic = 'force-dynamic'

import { LearnExperience } from '@/components/learn/LearnExperience'
import { getDb } from '@/lib/db'
import { generateWithGemini } from '@/lib/ai/gemini/client'
import { parseGeminiJson } from '@/lib/ai/gemini/json'
import crypto from 'crypto'
import { getRequiredUserId } from '@/lib/server/currentUser'

async function generatePagesForTopic(course: any, topic: any) {
  const isSourceGrounded = course.mode === 'source_grounded'
  const sourceText = course.source_text || ''
  const hasSubtopics = topic.subtopics && topic.subtopics.length > 0
  const subtopicsText = hasSubtopics
    ? topic.subtopics.map((s: any) => `- Page ${s.page_number}: Focus on "${s.title}" (${s.focus})`).join('\n')
    : ''

  const system = `You are TruLurn's topic lesson page writer.
Generate a structured, clear, textbook-like lesson page sequence for the topic.
Format each page content as high-quality Markdown, focusing on depth, clarity, and explanations. Do not include chat intro/outros.
For each page, return a markdown section containing the content.

Return ONLY a valid JSON array of 3 page objects, like this:
[
  {
    "page_number": 1,
    "content": "markdown content for page 1..."
  },
  {
    "page_number": 2,
    "content": "markdown content for page 2..."
  },
  {
    "page_number": 3,
    "content": "markdown content for page 3..."
  }
]`

  const user = `Course Topic: ${course.topic}
Specific Topic to write lessons for: ${topic.title}
Student learning goals: ${course.goals || 'Master the subject.'}
Mode: ${course.mode}

${hasSubtopics ? `Follow this planned subtopic roadmap for the pages strictly:
${subtopicsText}
` : ''}

${isSourceGrounded ? `Use ONLY the following source text to ground the explanation. Do not use external knowledge.
Source Text:
---
${sourceText}
---` : 'Use general AI teaching knowledge to build a thorough, structured, conceptual lesson.'}

Generate exactly 3 pages of content. ${hasSubtopics ? 'Ensure each page matches its corresponding subtopic focus listed above.' : 'Make sure page 1 introduces the concept, page 2 explains the core mechanism and equations/details, and page 3 summarizes, details edge cases, and prepares the user for the quiz.'}`

  const prompt = { system, user }
  const text = await generateWithGemini(prompt)
  const pagesList = parseGeminiJson<any[]>(text)
  return pagesList
}

export default async function LearnTopicPage({
  params,
  searchParams,
}: {
  params: { courseId: string; topicId: string }
  searchParams?: { page?: string }
}) {
  const db = await getDb()
  const userId = await getRequiredUserId()

  // 1. Fetch Course
  const course = await db.collection('courses').findOne({ _id: params.courseId as any, user_id: userId })
  if (!course) {
    return <div style={{ padding: 40 }}>Course not found.</div>
  }

  // 2. Fetch Topic
  const topic = await db.collection('topics').findOne({ _id: params.topicId as any })
  if (!topic) {
    return <div style={{ padding: 40 }}>Topic not found.</div>
  }

  // 3. Fetch all topics in the same branch
  const branchTopics = await db.collection('topics')
    .find({ course_id: params.courseId, branch_id: topic.branch_id })
    .sort({ position: 1 })
    .toArray()

  // 4. Fetch Pages for this topic
  let pages = await db.collection('pages')
    .find({ topic_id: params.topicId })
    .sort({ page_number: 1 })
    .toArray()

  // 5. If no pages, generate them on the fly
  if (!pages.length) {
    try {
      const generated = await generatePagesForTopic(course, topic)
      const pagesToInsert = generated.map((p: any) => ({
        _id: crypto.randomUUID() as any,
        topic_id: params.topicId,
        page_number: p.page_number || p.pageNumber || 1,
        content: p.content,
        created_at: new Date(),
      }))
      await db.collection('pages').insertMany(pagesToInsert)
      pages = await db.collection('pages')
        .find({ topic_id: params.topicId })
        .sort({ page_number: 1 })
        .toArray()
    } catch (err) {
      console.error('Failed to generate pages on the fly:', err)
      return (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <h2>Failed to generate lesson content</h2>
          <p>Please check your connection and refresh the page.</p>
        </div>
      )
    }
  }

  const requestedPage = Number(searchParams?.page ?? '1')
  const safePage = Math.min(Math.max(requestedPage, 1), pages.length)
  const activePage = pages[safePage - 1]

  // 6. Fetch Doubt Messages for this topic
  const messages = await db.collection('doubtMessages')
    .find({ topic_id: params.topicId })
    .sort({ created_at: 1 })
    .toArray()

  // 7. Format data for LearnExperience component
  const serializedTopic = {
    id: String(topic._id),
    course_id: String(topic.course_id),
    title: topic.title,
    parent_id: topic.parent_id ? String(topic.parent_id) : null,
    position: topic.position,
    state: topic.state as any,
    understanding_level: topic.understanding_level,
    prerequisites: topic.prerequisites || [],
    created_at: topic.created_at.toISOString(),
    branch_id: String(topic.branch_id),
    section: topic.section,
  }

  const serializedTopics = branchTopics.map((t) => ({
    id: String(t._id),
    course_id: String(t.course_id),
    title: t.title,
    parent_id: t.parent_id ? String(t.parent_id) : null,
    position: t.position,
    state: t.state as any,
    understanding_level: t.understanding_level,
    prerequisites: t.prerequisites || [],
    created_at: t.created_at.toISOString(),
    branch_id: String(t.branch_id),
    section: t.section,
  }))

  const serializedPage = {
    id: String(activePage._id),
    topic_id: String(activePage.topic_id),
    page_number: activePage.page_number,
    content: activePage.content,
    created_at: activePage.created_at.toISOString(),
  }

  const serializedMessages = messages.map((m) => ({
    id: String(m._id),
    topic_id: String(m.topic_id),
    page_number: m.page_number,
    role: m.role as any,
    content: m.content,
    created_at: m.created_at.toISOString(),
  }))

  return (
    <LearnExperience
      courseId={params.courseId}
      topic={serializedTopic}
      topics={serializedTopics}
      page={serializedPage}
      totalPages={pages.length}
      initialMessages={serializedMessages}
    />
  )
}
