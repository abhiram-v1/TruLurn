import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import crypto from 'crypto'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { buildPageDocument, generateTopicPage } from '@/lib/topic-pages/generateTopicPage'
import { buildGenerationPointer, firstTeachableDescendant, isContainerTopic, nextRecommendedTeachableTopic } from '@/lib/traccia/sequence'
import { buildSequenceContextPack } from '@/lib/traccia/sequenceContext'
import { embedPageById, retrieveCourseMemory } from '@/lib/vector/retrieval'
import { invalidateConceptMapCache } from '@/lib/doubts/conceptMap'

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

    const branchTopics = await db.collection('topics')
      .find({ course_id: courseId, branch_id: topic.branch_id })
      .sort({ sequence_index: 1, position: 1 })
      .toArray()

    if (isContainerTopic(topic)) {
      const descendant = firstTeachableDescendant(branchTopics as any, String(topic._id))
      if (descendant) {
        return NextResponse.json({
          redirectTo: `/learn/${courseId}/${encodeURIComponent(String(descendant._id))}`,
          skippedContainer: true,
        })
      }

      return NextResponse.json({ error: 'This Traccia node is structural and has no teachable child yet.' }, { status: 400 })
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

    const memoryQuery = [
      course.title ?? course.topic,
      topic.title,
      topic.description ?? topic.summary,
      `page ${pageNumber}`,
    ].filter(Boolean).join(' | ')

    // Fetch previous pages and course memory in parallel — independent operations.
    // Project only the fields formatPreviousPages uses; sections (largest field) excluded.
    const [previousPages, memory] = await Promise.all([
      db.collection('pages')
        .find({
          course_id: courseId,
          topic_id: params.topicId,
          page_number: { $lt: pageNumber },
        })
        .sort({ page_number: 1 })
        .project({ page_number: 1, focus: 1, summary: 1, key_concepts: 1, content: 1 })
        .toArray(),
      retrieveCourseMemory({
        db,
        query: memoryQuery,
        courseId,
        userId,
        currentTopicId: params.topicId,
        pageLimit: 3,
        doubtLimit: 3,
        sourceLimit: 3,
      }),
    ])
    const pointer = await buildGenerationPointer({
      db,
      courseId,
      topic,
      pageNumber,
    })
    const sequenceContext = await buildSequenceContextPack({
      db,
      courseId,
      userId,
      topic,
      pageNumber,
      previousPages,
      memory,
    })

    const generated = await generateTopicPage({
      course,
      topic,
      pageNumber,
      previousPages,
      memory,
      mapPointer: pointer.text,
      sequenceContext: sequenceContext.text,
      approach,
      customInstruction,
    })

    if (!generated.should_generate_page || generated.content_kind === 'skip') {
      const nextTopic = nextRecommendedTeachableTopic(branchTopics as any, String(topic._id))
      await db.collection('learningEvents').insertOne({
        _id: crypto.randomUUID() as any,
        course_id: courseId,
        topic_id: params.topicId,
        user_id: userId,
        event_type: 'content_shape_skip',
        page_number: pageNumber,
        content_kind: generated.content_kind,
        reason: generated.decision_reason,
        next_topic_id: nextTopic ? String(nextTopic._id) : null,
        created_at: new Date(),
      })
      await db.collection('topics').updateOne(
        { _id: params.topicId as any, course_id: courseId },
        {
          $set: {
            content_state: 'skipped',
            skip_reason: generated.decision_reason,
            updated_at: new Date(),
          },
        },
      )

      return NextResponse.json({
        skipped: true,
        reason: generated.decision_reason,
        redirectTo: nextTopic ? `/learn/${courseId}/${encodeURIComponent(String(nextTopic._id))}` : `/course/${courseId}`,
      })
    }
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
      covered_concepts: generated.covered_concepts,
      reused_concepts: generated.reused_concepts,
      reminder_concepts: generated.reminder_concepts,
      example_refs: generated.example_refs,
      created_at: new Date(),
    })
    // Run both concept-map writes in parallel — independent collections.
    // Invalidate the in-process concept map cache so the next doubt message
    // sees the newly covered concepts without waiting for TTL expiry.
    await Promise.all([
      db.collection('topicSummaries').updateOne(
        { course_id: courseId, topic_id: params.topicId },
        {
          $addToSet: { key_concepts: { $each: generated.key_concepts } },
          $set: { updated_at: new Date() },
        },
      ),
      db.collection('topics').updateOne(
        { _id: params.topicId as any, course_id: courseId },
        {
          $addToSet: { key_concepts: { $each: generated.key_concepts } },
          $set: { updated_at: new Date() },
        },
      ),
    ])
    invalidateConceptMapCache(courseId)
    if (
      generated.reused_concepts.length
      || generated.reminder_concepts.length
      || generated.example_refs.length
    ) {
      await db.collection('learningEvents').insertOne({
        _id: crypto.randomUUID() as any,
        course_id: courseId,
        topic_id: params.topicId,
        user_id: userId,
        event_type: 'sequence_context_applied',
        page_id: String(pageDocument._id),
        page_number: generated.page_number,
        covered_concepts: generated.covered_concepts,
        reused_concepts: generated.reused_concepts,
        reminder_concepts: generated.reminder_concepts,
        example_refs: generated.example_refs,
        created_at: new Date(),
      })
    }

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
