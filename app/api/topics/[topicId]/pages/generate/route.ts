export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import crypto from 'crypto'
import { getRequiredUserId } from '@/lib/server/currentUser'
import {
  buildPageDocument,
  generateTopicPage,
  type GeneratedTopicPage,
} from '@/lib/topic-pages/generateTopicPage'
import { buildGenerationPointer, firstTeachableDescendant, isContainerTopic, nextRecommendedTeachableTopic } from '@/lib/traccia/sequence'
import { buildSequenceContextPack } from '@/lib/traccia/sequenceContext'
import {
  backfillCourseSourceEmbeddings,
  embedPageById,
  getSourceIndexReadiness,
  retrieveCourseMemory,
} from '@/lib/vector/retrieval'
import { ensureLexicalSearchIndexes, ensureVectorSearchIndexes } from '@/lib/vector/indexes'
import { invalidateConceptMapCache } from '@/lib/doubts/conceptMap'
import { analyzeLearningArchitecture, type LearningArchitectureBrief } from '@/lib/learning-architecture/analyzePage'
import {
  analyzeTopicPlan,
  formatPageBoundaryPlan,
  isPlanCurrent,
  PLAN_VERSION,
  type TopicLessonPlan,
} from '@/lib/learning-architecture/analyzeTopicPlan'
import { policyFromCourse } from '@/lib/course-generation/sourceFidelity'
import { researchLessonConcept } from '@/lib/course-generation/research'
import { buildLearnerStateContext, getLearnerProfile } from '@/lib/personalization/engine'
import {
  buildSourceEvidencePackets,
  SourceGroundingError,
  verifyGroundedLesson,
} from '@/lib/grounding/sourceGrounding'
import {
  evaluateLessonQuality,
  LessonQualityError,
  type LessonQualityRepairRecord,
  type LessonQualityReport,
} from '@/lib/topic-pages/lessonQuality'
import {
  buildGenerationAuthority,
  CourseScopeError,
} from '@/lib/topic-pages/generationAuthority'
import { retrieveCourseSkillContext } from '@/lib/course-skills/context'
import { findRelevantSourceImages } from '@/lib/sources/images'
import { invalidateCourse, getCachedCourse, getCachedTopic, getCachedTopicPages, getCachedCourseTopics } from '@/lib/cache/courseData'

type GeneratePageBody = {
  courseId?: string
  pageNumber?: number
  force?: boolean
  approach?: 'explain_again' | 'go_deeper' | 'simplify' | 'show_example' | 'concise'
  customInstruction?: string
}

function isBlankGeneratedPage(page: any) {
  const content = String(page?.content ?? '').trim()
  const sectionContent = Array.isArray(page?.sections)
    ? page.sections.map((section: any) => String(section?.content ?? '').trim()).join('')
    : ''

  return content.length < 60 && sectionContent.length < 60
}

function fallbackPageFocus(topic: any, pageNumber: number) {
  if (pageNumber === 1) return `Introduce ${topic.title}, its role in the course, and the core intuition.`
  return `Continue ${topic.title} with the next necessary concept slice.`
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
    const course = await getCachedCourse(db, courseId, userId)

    if (!course) {
      return NextResponse.json({ error: 'Course not found.' }, { status: 404 })
    }

    const topic = await getCachedTopic(db, courseId, params.topicId)

    if (!topic) {
      return NextResponse.json({ error: 'Topic not found.' }, { status: 404 })
    }

    const scopePreflight = buildGenerationAuthority({
      course,
      topic,
      pageNumber,
      pageCount: 1,
      focus: fallbackPageFocus(topic, pageNumber),
    })
    if (!scopePreflight.scope.allowed) throw new CourseScopeError(scopePreflight)

    const allTopics = await getCachedCourseTopics(db, courseId)
    const branchTopics = allTopics
      .filter((t) => String(t.branch_id) === String(topic.branch_id))
      .sort((a, b) => {
        const aSeq = Number(a.sequence_index ?? 0)
        const bSeq = Number(b.sequence_index ?? 0)
        if (aSeq !== bSeq) return aSeq - bSeq
        return Number(a.position ?? 0) - Number(b.position ?? 0)
      })

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

    const topicPages = await getCachedTopicPages(db, courseId, params.topicId)
    const existing = topicPages.find((p: any) => p.page_number === pageNumber) ?? null

    const existingIsBlank = existing ? isBlankGeneratedPage(existing) : false

    if (existing && !force && !existingIsBlank) {
      return NextResponse.json({
        pageId: String(existing._id),
        alreadyExists: true,
      })
    }

    if (String(course.mode ?? '') === 'source_grounded') {
      // 1. Wait briefly for style job to finish (up to 4000ms)
      if (course.source_profile && 'schema_version' in course.source_profile) {
        const envelope = course.source_profile as any
        if (envelope.style_status === 'pending' || envelope.style_status === 'processing') {
          const start = Date.now()
          while (Date.now() - start < 4000) {
            const job = await db.collection('sourceStyleJobs').findOne({ source_fingerprint: envelope.source_fingerprint })
            if (job && job.status === 'completed') {
              envelope.style = job.style
              envelope.style_status = 'ready'
              envelope.style_generated_at = new Date().toISOString()
              await db.collection('courses').updateOne(
                { _id: course._id },
                { $set: { source_profile: envelope } }
              )
              break
            }
            if (job && job.status === 'failed') {
              break
            }
            await new Promise(resolve => setTimeout(resolve, 500))
          }
        }
      }

      // 2. Wait briefly for retrieval index & vector embeddings (up to 4000ms)
      let sourceReadiness = await getSourceIndexReadiness(db, courseId, userId)
      if (!sourceReadiness.indexReady) {
        await Promise.all([
          ensureVectorSearchIndexes(db),
          ensureLexicalSearchIndexes(db),
        ])
        sourceReadiness = await getSourceIndexReadiness(db, courseId, userId)
      }

      const start = Date.now()
      while (Date.now() - start < 4000) {
        sourceReadiness = await getSourceIndexReadiness(db, courseId, userId)
        if (sourceReadiness.ready) break
        // Trigger backfill if needed
        if (sourceReadiness.indexReady && sourceReadiness.readyCount < sourceReadiness.total) {
          await backfillCourseSourceEmbeddings(db, userId, courseId)
        }
        await new Promise(resolve => setTimeout(resolve, 500))
      }

      if (!sourceReadiness.indexReady) {
        return NextResponse.json({
          error: 'The search indexes are still being created. Please wait a moment and try again.',
          code: 'SOURCE_INDEX_NOT_READY',
          sourceIndex: sourceReadiness,
        }, { status: 409 })
      }

      if (!sourceReadiness.ready) {
        return NextResponse.json({
          error: sourceReadiness.failedCount
            ? 'Some source passages could not be indexed. Please retry after the source indexing job recovers.'
            : 'Your source is still being indexed. Please wait a moment and try again.',
          code: sourceReadiness.failedCount
            ? 'SOURCE_RETRIEVAL_DEGRADED'
            : 'SOURCE_RETRIEVAL_PENDING',
          sourceIndex: sourceReadiness,
        }, { status: sourceReadiness.failedCount ? 503 : 409 })
      }
    }

    const t0 = performance.now()

    const memoryQuery = [
      course.title ?? course.topic,
      topic.title,
      topic.description ?? topic.summary,
      `page ${pageNumber}`,
    ].filter(Boolean).join(' | ')

    // Fetch previous pages, course memory, and the learner profile in parallel —
    // independent operations. Project only the fields formatPreviousPages uses;
    // sections (largest field) excluded. The profile is cached, so this is cheap.
    const [
      previousPages,
      memory,
      learnerProfile,
      courseSkillPlanningContext,
      courseSkillLessonContext,
    ] = await Promise.all([
      Promise.resolve(
        topicPages
          .filter((p: any) => p.page_number < pageNumber)
          .map((p: any) => ({
            page_number: p.page_number,
            focus: p.focus,
            summary: p.summary,
            key_concepts: p.key_concepts,
            content: p.content,
            example_to_use: p.example_to_use,
          }))
          .sort((a: any, b: any) => a.page_number - b.page_number)
      ),
      retrieveCourseMemory({
        db,
        query: memoryQuery,
        courseId,
        userId,
        currentTopicId: params.topicId,
        pageLimit: 3,
        // Learner questions are useful to the doubt workflow, but they are not
        // authoritative lesson evidence.
        doubtLimit: 0,
        // Source-based courses lean much harder on source excerpts — they are
        // the only permitted content, so retrieve more of them.
        sourceLimit: String(course.mode ?? '') === 'source_grounded' ? 8 : 3,
        workflow: 'lesson_generation',
      }),
      getLearnerProfile(db, userId, courseId).catch((error) => {
        console.warn('[pageGen] Learner profile unavailable — generating without personalization.', error)
        return null
      }),
      retrieveCourseSkillContext({
        db,
        course,
        query: memoryQuery,
        surface: 'planning',
      }).catch((error) => {
        console.warn('[pageGen] Course skill context unavailable.', error)
        return null
      }),
      retrieveCourseSkillContext({
        db,
        course,
        query: memoryQuery,
        surface: 'lesson',
      }).catch((error) => {
        console.warn('[pageGen] Lesson skill context unavailable.', error)
        return null
      }),
    ])

    if (String(course.mode ?? '') === 'source_grounded' && !memory.sourceChunks.length) {
      return NextResponse.json({
        error: 'No relevant source evidence could be retrieved safely. The page was not generated.',
        code: 'SOURCE_RETRIEVAL_EMPTY',
        retrievalTraceId: memory.traceId,
      }, { status: 503 })
    }
    const sourceEvidence = buildSourceEvidencePackets(memory.sourceChunks)
    const pointer = await buildGenerationPointer({
      db,
      courseId,
      topic,
      pageNumber,
    })

    // If the student failed a quiz on this topic and no manual approach was chosen,
    // automatically use the approach the exam engine identified as most useful.
    const effectiveApproach: typeof approach = approach
      ?? (topic.needs_review && !customInstruction ? topic.review_approach ?? 'explain_again' : undefined)
    const isAdHoc = Boolean(customInstruction || effectiveApproach)

    // The curriculum page count is an early estimate, not a physical pagination
    // limit. Give the length planner modest headroom so content can flow onto
    // another page instead of producing an overloaded final page.
    const estimatedPages = Math.max(1, Number(topic.estimated_pages ?? topic.total_pages_planned ?? 3))
    const retrievedSourceWords = memory.sourceChunks.reduce(
      (sum, chunk) => sum + String(chunk.content ?? '').split(/\s+/).filter(Boolean).length,
      0,
    )
    const sourceLengthPages = retrievedSourceWords > 0
      ? Math.ceil(retrievedSourceWords / 700)
      : 0
    const planningPageLimit = Math.min(
      15,
      Math.max(estimatedPages + 2, sourceLengthPages, estimatedPages),
    )

    // Topic-level plan: ONE call per topic, cached on the topic document, replacing
    // the per-page architecture brief. Generated lazily on first touch. The plan
    // is authoritative: it sets planned_pages on the topic, which gates navigation
    // and prefetch so thin topics stay thin.
    const planTopic = topic
    // Adaptive fidelity: the plan is keyed to the course's CURRENT source
    // fidelity policy. A mid-course style or coverage change produces a new
    // key, so the topic re-plans on next touch instead of serving a plan
    // built under the old policy. ai_teacher courses key to null (no churn).
    const expectedFidelityKey = policyFromCourse(course)?.key ?? null
    const expectedSkillContextKey = courseSkillPlanningContext?.key ?? null
    async function ensureTopicPlan(): Promise<TopicLessonPlan> {
      const existing = planTopic.lesson_plan as TopicLessonPlan | undefined
      // Do not replace the page boundaries underneath an in-progress topic.
      // Untouched v5 plans upgrade to the GPT-5.4 planner automatically, while
      // topics with generated pages keep their internally consistent old plan.
      const hasGeneratedPages = topicPages.some((page: any) => String(page?.content ?? '').trim())
      const legacyPlanMatchesContext = existing
        && (existing.fidelity_key ?? null) === expectedFidelityKey
        && (existing.skill_context_key ?? null) === expectedSkillContextKey
      if (
        legacyPlanMatchesContext
        && Number(existing.version) < PLAN_VERSION
        && hasGeneratedPages
      ) {
        return existing
      }
      if (isPlanCurrent(existing, expectedFidelityKey, expectedSkillContextKey)) return existing
      const pageFocuses: string[] = Array.isArray(planTopic.page_focuses) && planTopic.page_focuses.length
        ? planTopic.page_focuses.map((entry: any, i: number) => String(entry?.focus ?? fallbackPageFocus(planTopic, i + 1)))
        : Array.from({ length: estimatedPages }, (_, i) => fallbackPageFocus(planTopic, i + 1))
      const plan = await analyzeTopicPlan({
        course,
        topic: planTopic,
        plannedPages: planningPageLimit,
        pageFocuses,
        mapPointer: pointer.text,
        memory,
        courseSkillContext: courseSkillPlanningContext?.text,
        courseSkillContextKey: expectedSkillContextKey,
      })
      await db.collection('topics').updateOne(
        { _id: params.topicId as any, course_id: courseId },
        { $set: { lesson_plan: plan, planned_pages: plan.pages.length, updated_at: new Date() } },
      )
      return plan
    }

    const t1 = performance.now()

    const plan = await ensureTopicPlan()

    const t2 = performance.now()

    const planLength = plan.pages.length
    const planned = plan?.pages.find((p) => p.page_number === pageNumber) ?? null

    // ── Hard cap ─────────────────────────────────────────────────────────────
    // Navigation and prefetch can never mint pages past the plan. This returns
    // before any model call, so over-eager clients cost nothing.
    if (!existing && pageNumber > planLength) {
      return NextResponse.json({
        topicComplete: true,
        plannedPages: planLength,
        reason: plan?.page_count_reason ?? 'This topic is fully covered by its planned pages.',
      })
    }

    const plannedPages = planLength
    const focus = customInstruction
      ? customInstruction
      : (planned?.focus ?? topic.page_focuses?.[pageNumber - 1]?.focus ?? fallbackPageFocus(topic, pageNumber))

    const sequenceContext = await buildSequenceContextPack({
      db,
      courseId,
      userId,
      topic,
      pageNumber,
      previousPages,
      memory,
    })

    const perPageBriefArgs = {
      course,
      topic,
      pageNumber,
      plannedPages,
      focus,
      contentKind: planned?.content_kind ?? 'full_page',
      previousPages,
      memory,
      mapPointer: pointer.text,
      sequenceContext: sequenceContext.text,
      courseSkillContext: courseSkillPlanningContext?.text,
      pageBoundaryContext: planned ? formatPageBoundaryPlan(planned) : undefined,
    }

    // Web research is the most expensive per-page call — spend it only where it
    // pays: substantive full pages and deliberate ad-hoc requests. Bridges,
    // sections, and examples teach from course context alone. Source-based
    // courses skip it entirely — lessons must stay traceable to the uploaded
    // material, and web research would inject outside content.
    const wantsResearch = String(course.mode ?? '') !== 'source_grounded'
      && (isAdHoc || !planned || planned.content_kind === 'full_page')
    const researchPromise = wantsResearch
      ? researchLessonConcept({
          courseTitle: course.title ?? course.topic ?? '',
          topicTitle: topic.title ?? '',
          focus,
          cache: {
            db,
            userId,
            courseId,
            topicId: params.topicId,
            pageNumber,
          },
        })
      : Promise.resolve({ found: false, context: '', sources: [] })

    // Determine whether a fresh brief is needed from the AI.
    // Full-page plans cache the brief; ad-hoc requests and missing plans always need a new one.
    const needsFreshBrief =
      isAdHoc ||
      !planned ||
      (planned.content_kind === 'full_page' && !planned.brief)
    const cachedBrief: LearningArchitectureBrief | undefined =
      !needsFreshBrief && planned?.content_kind === 'full_page' ? (planned.brief ?? undefined) : undefined

    let learningArchitecture: LearningArchitectureBrief | undefined
    let lessonResearch: Awaited<ReturnType<typeof researchLessonConcept>>

    if (needsFreshBrief) {
      // Both are independent AI calls (~1–2 s each) — run them together.
      ;[learningArchitecture, lessonResearch] = await Promise.all([
        analyzeLearningArchitecture(perPageBriefArgs),
        researchPromise,
      ])
    } else {
      // Brief is cached from the topic plan; research can finish in the background.
      learningArchitecture = cachedBrief
      lessonResearch = await researchPromise
    }

    const authority = buildGenerationAuthority({
      course,
      topic,
      pageNumber,
      pageCount: plannedPages,
      focus,
      plannedPage: planned,
      architecture: learningArchitecture,
    })
    if (!authority.scope.allowed) throw new CourseScopeError(authority)

    const nextTopicForPage = nextRecommendedTeachableTopic(branchTopics as any, String(topic._id))
    const priorExample = previousPages.at(-1)?.example_to_use ?? undefined
    const relevantLearnerConcepts = [
      ...(Array.isArray(topic.key_concepts) ? topic.key_concepts.map(String) : []),
      ...(learningArchitecture?.required_prior_knowledge ?? []),
      ...(learningArchitecture?.prior_knowledge_repair ?? []),
    ].filter((value): value is string => Boolean(value))
    if (!relevantLearnerConcepts.length) relevantLearnerConcepts.push(focus)

    // Source figures: for source-grounded courses, surface the images extracted
    // from the uploaded material that best match this page's focus, so the lesson
    // can teach directly from the original diagrams/charts. Best-effort.
    const availableFigures = String(course.mode ?? '') === 'source_grounded'
      ? await findRelevantSourceImages(db, {
          courseId,
          userId,
          queryText: [focus, topic.title].filter(Boolean).join(' | '),
          limit: 2,
        }).catch((error) => {
          console.warn('[pageGen] Source figure retrieval unavailable.', error)
          return []
        })
      : []

    const generationInput = {
      course,
      topic,
      pageNumber,
      previousPages,
      memory,
      mapPointer: pointer.text,
      sequenceContext: sequenceContext.text,
      learningArchitecture,
      approach: effectiveApproach,
      customInstruction,
      lessonResearch: lessonResearch.found ? lessonResearch.context : undefined,
      courseSkillContext: courseSkillLessonContext?.text,
      learnerStateContext: buildLearnerStateContext(
        learnerProfile,
        relevantLearnerConcepts,
      ),
      authority,
      sourceEvidence,
      availableFigures,
      nextTopicTitle: nextTopicForPage ? String(nextTopicForPage.title) : undefined,
      priorExample,
    }
    const generateAndVerify = async (qualityRepair?: {
      report: LessonQualityReport
      previousDraft: GeneratedTopicPage
    }) => {
      let draft = await generateTopicPage({
        ...generationInput,
        qualityRepair,
      })
      if (
        String(course.mode ?? '') === 'source_grounded'
        && topic.source_coverage !== 'inferred'
        && draft.should_generate_page
        && draft.content_kind !== 'skip'
      ) {
        const verified = await verifyGroundedLesson({
          sections: draft.sections,
          packets: sourceEvidence,
        })
        draft = {
          ...draft,
          sections: verified.sections,
          content: verified.content,
          source_citations: verified.citations,
          grounding: verified.report,
        }
      }
      return draft
    }

    const t3 = performance.now()

    let generated = await generateAndVerify()

    if (!generated.should_generate_page || generated.content_kind === 'skip') {
      const nextTopic = nextRecommendedTeachableTopic(branchTopics as any, String(topic._id))
      if (existing) {
        await Promise.all([
          db.collection('pages').deleteOne({ _id: existing._id }),
          db.collection('pageSummaries').deleteOne({ page_id: String(existing._id) }),
        ])
      }
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
        learning_architecture: learningArchitecture ?? null,
        target_understanding: learningArchitecture?.target_understanding ?? null,
        retention_hooks: learningArchitecture?.retention_hooks ?? null,
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

      invalidateCourse(courseId)
      return NextResponse.json({
        skipped: true,
        reason: generated.decision_reason,
        redirectTo: nextTopic ? `/learn/${courseId}/${encodeURIComponent(String(nextTopic._id))}` : `/course/${courseId}`,
      })
    }

    const t4 = performance.now()

    const sourceGrounded = String(course.mode ?? '') === 'source_grounded'
      && topic.source_coverage !== 'inferred'
    const qualityRepairHistory: LessonQualityRepairRecord[] = []
    let lessonQuality = evaluateLessonQuality({
      page: generated,
      topic,
      pageNumber,
      previousPages,
      architecture: learningArchitecture,
      sourceGrounded,
      pagePlan: planned,
    })

    const MAX_QUALITY_REPAIRS = 2
    for (let attempt = 1; !lessonQuality.accepted && attempt <= MAX_QUALITY_REPAIRS; attempt += 1) {
      qualityRepairHistory.push({
        attempt,
        trigger_score: lessonQuality.overall_score,
        issues: lessonQuality.issues,
        created_at: new Date(),
      })
      const previousDraft = generated
      generated = await generateAndVerify({
        report: lessonQuality,
        previousDraft,
      })
      lessonQuality = evaluateLessonQuality({
        page: generated,
        topic,
        pageNumber,
        previousPages,
        architecture: learningArchitecture,
        sourceGrounded,
        pagePlan: planned,
      })
    }

    generated = {
      ...generated,
      lesson_quality: lessonQuality,
      quality_repair_history: qualityRepairHistory,
    }

    if (!lessonQuality.accepted) {
      await db.collection('learningEvents').insertOne({
        _id: crypto.randomUUID() as any,
        course_id: courseId,
        topic_id: params.topicId,
        user_id: userId,
        event_type: 'lesson_quality_rejected',
        page_number: pageNumber,
        quality_score: lessonQuality.overall_score,
        quality_threshold: lessonQuality.threshold,
        quality_dimensions: lessonQuality.dimensions,
        quality_issues: lessonQuality.issues,
        repair_attempts: qualityRepairHistory.length,
        created_at: new Date(),
      })
      throw new LessonQualityError(lessonQuality)
    }

    const pageDocument = buildPageDocument({
      courseId,
      topicId: params.topicId,
      userId,
      page: generated,
    })

    if (existing) {
      await Promise.all([
        db.collection('pages').deleteOne({ _id: existing._id }),
        db.collection('pageSummaries').deleteOne({ page_id: String(existing._id) }),
      ])
    }
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
      learning_architecture: generated.learning_architecture ?? null,
      target_understanding: generated.learning_architecture?.target_understanding ?? null,
      success_criteria: generated.learning_architecture?.success_criteria ?? [],
      active_processing: generated.learning_architecture?.active_processing ?? null,
      retention_hooks: generated.learning_architecture?.retention_hooks ?? null,
      page_sequence_role: generated.learning_architecture?.page_sequence_role ?? null,
      source_citations: generated.source_citations ?? [],
      grounding: generated.grounding ?? null,
      lesson_quality: generated.lesson_quality ?? null,
      quality_repair_history: generated.quality_repair_history ?? [],
      generation_authority: generated.generation_authority ?? null,
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
    await db.collection('learningEvents').insertOne({
      _id: crypto.randomUUID() as any,
      course_id: courseId,
      topic_id: params.topicId,
      user_id: userId,
      event_type: qualityRepairHistory.length
        ? 'lesson_quality_repaired'
        : 'lesson_quality_accepted',
      page_id: String(pageDocument._id),
      page_number: generated.page_number,
      quality_score: lessonQuality.overall_score,
      quality_threshold: lessonQuality.threshold,
      quality_dimensions: lessonQuality.dimensions,
      quality_issues: lessonQuality.issues,
      repair_attempts: qualityRepairHistory.length,
      created_at: new Date(),
    })
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
    const architectureEvents = learningArchitecture
      ? [
          {
            event_type: 'learning_architecture_created',
            target_understanding: learningArchitecture.target_understanding,
            page_sequence_role: learningArchitecture.page_sequence_role,
            recommended_content_kind: learningArchitecture.recommended_content_kind,
          },
          learningArchitecture.prior_knowledge_repair.length
            ? {
                event_type: 'prior_knowledge_repair_planned',
                prior_knowledge_repair: learningArchitecture.prior_knowledge_repair,
              }
            : null,
          learningArchitecture.likely_misconceptions.length
            ? {
                event_type: 'misconception_risk_identified',
                likely_misconceptions: learningArchitecture.likely_misconceptions,
              }
            : null,
          learningArchitecture.retention_hooks.retrieval_prompt
            ? {
                event_type: 'retrieval_hook_created',
                retrieval_prompt: learningArchitecture.retention_hooks.retrieval_prompt,
                revisit_concepts: learningArchitecture.retention_hooks.revisit_concepts,
              }
            : null,
          learningArchitecture.retention_hooks.transfer_prompt
            ? {
                event_type: 'transfer_hook_created',
                transfer_prompt: learningArchitecture.retention_hooks.transfer_prompt,
                revisit_concepts: learningArchitecture.retention_hooks.revisit_concepts,
              }
            : null,
        ].filter(Boolean)
      : []

    if (architectureEvents.length) {
      await db.collection('learningEvents').insertMany(
        architectureEvents.map((event: any) => ({
          _id: crypto.randomUUID() as any,
          course_id: courseId,
          topic_id: params.topicId,
          user_id: userId,
          page_id: String(pageDocument._id),
          page_number: generated.page_number,
          ...event,
          created_at: new Date(),
        })),
      )
    }

    const t5 = performance.now()
    // Structured timing log — grep for 'page_generation_timing' to monitor pipeline.
    void db.collection('learningEvents').insertOne({
      _id: crypto.randomUUID() as any,
      course_id: courseId,
      topic_id: params.topicId,
      user_id: userId,
      event_type: 'page_generation_timing',
      page_id: String(pageDocument._id),
      page_number: pageNumber,
      timings: {
        context_ms: Math.round(t1 - t0),
        plan_ms: Math.round(t2 - t1),
        brief_research_ms: Math.round(t3 - t2),
        generation_ms: Math.round(t4 - t3),
        quality_ms: Math.round(t5 - t4),
        total_ms: Math.round(t5 - t0),
      },
      repair_attempts: qualityRepairHistory.length,
      had_cached_brief: !needsFreshBrief,
      created_at: new Date(),
    }).catch(() => {})

    await embedPageById(db, String(pageDocument._id)).catch((error) => {
      console.warn('Failed to embed generated page.', error)
    })

    // Topic key_concepts / planned_pages / state changed — refresh cached structure.
    invalidateCourse(courseId)

    return NextResponse.json({
      pageId: String(pageDocument._id),
      pageNumber: generated.page_number,
      regenerated: (force || existingIsBlank) && Boolean(existing),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown page generation error'
    const status = message.includes('sign in')
      ? 401
      : error instanceof SourceGroundingError
        || error instanceof LessonQualityError
        || error instanceof CourseScopeError
        ? 422
        : 500

    return NextResponse.json({
      error: message,
      ...(error instanceof LessonQualityError
        ? { code: error.code, lessonQuality: error.report }
        : {}),
      ...(error instanceof CourseScopeError
        ? { code: error.code, generationAuthority: error.contract }
        : {}),
    }, { status })
  }
}
