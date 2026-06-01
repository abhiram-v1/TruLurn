import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { buildPageDocument, generateTopicPage } from '@/lib/topic-pages/generateTopicPage'
import { embedPageById, retrieveCourseMemory } from '@/lib/vector/retrieval'

type GeneratePageBody = {
  courseId?: string
  pageNumber?: number
  force?: boolean
  approach?: 'explain_again' | 'go_deeper' | 'simplify' | 'show_example'
  customInstruction?: string
}

function isBlankGeneratedPage(page: any) {
  const content = String(page?.content ?? '').trim()
  const sectionContent = Array.isArray(page?.sections)
    ? page.sections.map((section: any) => String(section?.content ?? '').trim()).join('')
    : ''

  return content.length < 60 && sectionContent.length < 60
}

export async function POST(
  request: Request,
  { params }: { params: { topicId: string } },
) {
  try {
    const body = (await request.json()) as GeneratePageBody
    const courseId = body.courseId?.trim()
    const pageNumber = Math.max(1, Number(body.pageNumber ?? 1))
    const force = Boolean(body.force)
    const approach = body.approach
    const customInstruction = body.customInstruction?.trim() || undefined

    if (!courseId) {
      return NextResponse.json({ error: 'courseId is required.' }, { status: 400 })
    }

    const db = await getDb()
    const userId = await getRequiredUserId()
    const course = await db.collection('courses').findOne({ _id: courseId as any, user_id: userId })

    if (!course) {
      return NextResponse.json({ error: 'Course not found.' }, { status: 404 })
    }

    const topic = await db.collection('topics').findOne({
      _id: params.topicId as any,
      course_id: courseId,
    })

    if (!topic) {
      return NextResponse.json({ error: 'Topic not found.' }, { status: 404 })
    }

    const existing = await db.collection('pages').findOne({
      course_id: courseId,
      topic_id: params.topicId,
      page_number: pageNumber,
    })

    const existingIsBlank = existing ? isBlankGeneratedPage(existing) : false

    if (existing && !force && !existingIsBlank) {
      return NextResponse.json({
        pageId: String(existing._id),
        alreadyExists: true,
      })
    }

    // Delete the old page + its summary so we can generate fresh
    if (existing) {
      await Promise.all([
        db.collection('pages').deleteOne({ _id: existing._id }),
        db.collection('pageSummaries').deleteOne({ page_id: String(existing._id) }),
      ])
    }

    const previousPages = await db.collection('pages')
      .find({
        course_id: courseId,
        topic_id: params.topicId,
        page_number: { $lt: pageNumber },
      })
      .sort({ page_number: 1 })
      .toArray()
    const memoryQuery = [
      course.title ?? course.topic,
      topic.title,
      topic.description ?? topic.summary,
      `page ${pageNumber}`,
    ].filter(Boolean).join(' | ')
    const memory = await retrieveCourseMemory({
      db,
      query: memoryQuery,
      courseId,
      userId,
      currentTopicId: params.topicId,
      pageLimit: 3,
      doubtLimit: 3,
      sourceLimit: 3,
    })

    const generated = await generateTopicPage({
      course,
      topic,
      pageNumber,
      previousPages,
      memory,
      approach,
      customInstruction,
    })
    const pageDocument = buildPageDocument({
      courseId,
      topicId: params.topicId,
      userId,
      page: generated,
    })

    await db.collection('pages').insertOne(pageDocument)
    await db.collection('pageSummaries').insertOne({
      _id: `${pageDocument._id}:summary` as any,
      course_id: courseId,
      topic_id: params.topicId,
      page_id: String(pageDocument._id),
      user_id: userId,
      page_number: generated.page_number,
      focus: generated.focus,
      summary: generated.summary,
      key_concepts: generated.key_concepts,
      created_at: new Date(),
    })
    await db.collection('topicSummaries').updateOne(
      { course_id: courseId, topic_id: params.topicId },
      {
        $addToSet: {
          key_concepts: { $each: generated.key_concepts },
        },
        $set: {
          updated_at: new Date(),
        },
      },
    )
    await db.collection('topics').updateOne(
      { _id: params.topicId as any, course_id: courseId },
      {
        $addToSet: {
          key_concepts: { $each: generated.key_concepts },
        },
        $set: {
          updated_at: new Date(),
        },
      },
    )

    embedPageById(db, String(pageDocument._id)).catch((error) => {
      console.warn('Failed to embed generated page.', error)
    })

    return NextResponse.json({
      pageId: String(pageDocument._id),
      pageNumber: generated.page_number,
      regenerated: (force || existingIsBlank) && Boolean(existing),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown page generation error'
    const status = message.includes('sign in') ? 401 : 500

    return NextResponse.json({ error: message }, { status })
  }
}
