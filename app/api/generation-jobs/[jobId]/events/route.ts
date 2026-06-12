export const dynamic = 'force-dynamic'

import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { validateTopicSuitability } from '@/lib/course-generation/topicValidator'
import { researchCurriculum, formatResearchBrief } from '@/lib/course-generation/research'
import { curriculumBuilderSkill, mapBuilderSkill } from '@/lib/ai/skills'
import { generateAI, parseAIJson } from '@/lib/ai'
import { determineLessonStyle } from '@/lib/ai/skills/lessonStyle'
import { persistGeneratedCourse } from '@/lib/course-generation/mongoPersistence'
import { orderSourceGroundedInput } from '@/lib/course-generation/sourceOrdering'
import { analyzeSourceProfile } from '@/lib/course-generation/sourceProfile'
import { readIngestedSourceText, resumeSourceIngestionJobs } from '@/lib/sources/ingestion'

const UNSUITABLE_MESSAGE =
  'This topic is not suitable for structured course creation. Please enter a subject that can be taught through multiple lessons, such as programming, mathematics, design, business, science, languages, or other professional skills.'

function sendSSE(controller: ReadableStreamDefaultController, event: string, data: any) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  controller.enqueue(new TextEncoder().encode(payload))
}

async function updateJobStage(
  db: any,
  jobId: string,
  userId: string,
  stage: string,
  statusMessage: string,
  completedStages: string[],
  extraData?: any
) {
  const stageLabels: Record<string, string> = {
    validating_input: 'Validating Input',
    extracting_sources: 'Extracting Sources',
    researching_curriculum: 'Researching Curriculum',
    building_curriculum: 'Building Curriculum',
    awaiting_curriculum_approval: 'Awaiting Your Review',
    building_atlas: 'Building Atlas',
    building_traccia: 'Building Traccia',
    connecting_prerequisites: 'Connecting Prerequisites',
    persisting_course: 'Persisting Course',
    preparing_workspace: 'Preparing Workspace',
    completed: 'Completed',
  }

  const update: any = {
    $set: {
      stage,
      stage_label: stageLabels[stage] || stage,
      message: statusMessage,
      completed_stages: completedStages,
      updated_at: new Date(),
    }
  }

  if (extraData) {
    Object.assign(update.$set, extraData)
  }

  await db.collection('generationJobs').updateOne(
    { _id: jobId, user_id: userId },
    update
  )

  const job = await db.collection('generationJobs').findOne({ _id: jobId, user_id: userId })
  return job
}

export async function GET(
  request: Request,
  { params }: { params: { jobId: string } }
) {
  const jobId = params.jobId
  let userId: string
  try {
    userId = await getRequiredUserId()
  } catch (e) {
    return new Response('Unauthorized', { status: 401 })
  }

  const db = (await getDb()) as any

  // Verify ownership
  const initialJob = await db.collection('generationJobs').findOne({ _id: jobId, user_id: userId })
  if (!initialJob) {
    return new Response('Not Found', { status: 404 })
  }

  const encoder = new TextEncoder()
  let isClosed = false

  const stream = new ReadableStream({
    async start(controller) {
      // Keep alive heartbeat loop
      const heartbeatInterval = setInterval(() => {
        if (isClosed) return
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
        } catch (e) {
          // ignore stream write errors
        }
      }, 5000)

      async function updateStage(stage: string, message: string, completedStages: string[], extra?: any) {
        if (isClosed) return
        const updated = await updateJobStage(db, jobId, userId, stage, message, completedStages, extra)
        if (updated) {
          sendSSE(controller, 'update', updated)
        }
      }

      try {
        let currentJob = await db.collection('generationJobs').findOne({ _id: jobId, user_id: userId })
        if (!currentJob) {
          throw new Error('Job not found')
        }

        // If already completed or failed, send final status and close
        if (currentJob.status === 'completed' || currentJob.status === 'failed') {
          sendSSE(controller, 'update', currentJob)
          clearInterval(heartbeatInterval)
          try { controller.close(); } catch(e) {}
          isClosed = true
          return
        }

        // Mark job as running if it's currently queued
        if (currentJob.status === 'queued') {
          await db.collection('generationJobs').updateOne(
            { _id: jobId, user_id: userId },
            { $set: { status: 'running', updated_at: new Date() } }
          )
          currentJob = await db.collection('generationJobs').findOne({ _id: jobId, user_id: userId })
        }

        // Run worker logic
        let input = currentJob.input
        const completedStages = currentJob.completed_stages || []

        // Stage 1: validating_input
        if (!completedStages.includes('validating_input')) {
          await updateStage('validating_input', 'Reviewing course topic and goals...', completedStages)
          if (input.mode !== 'source_grounded') {
            const suitability = await validateTopicSuitability(input.goals)
            if (!suitability.valid) {
              const err = new Error(UNSUITABLE_MESSAGE)
              ;(err as any).code = 'TOPIC_UNSUITABLE'
              throw err
            }
          }
          completedStages.push('validating_input')
          await updateStage('validating_input', 'Input validated.', completedStages)
        }

        // Stage 2: extracting_sources
        // Ordering rewrites the source sequence; profiling learns how the material
        // teaches and which full subject it belongs to. Independent — run in parallel.
        if ((input.mode === 'source_grounded' || input.sourceIngestionJobIds?.length) && !completedStages.includes('extracting_sources')) {
          await updateStage('extracting_sources', 'Studying how your material teaches and inferring source order...', completedStages)
          await resumeSourceIngestionJobs(db, input.sourceIngestionJobIds ?? [])
          const durableExtraction = input.sourceVersionIds?.length
            ? await readIngestedSourceText(db, userId, input.sourceVersionIds)
            : { sourceText: input.sourceText ?? '', limitations: input.sourceLimitations ?? [] }
          const baseInput = {
            ...input,
            topic: input.topic ?? input.goals,
            sourceText: durableExtraction.sourceText || input.sourceText,
            sourceLimitations: [
              ...(input.sourceLimitations ?? []),
              ...durableExtraction.limitations,
            ],
          }
          if (input.mode === 'source_grounded' && !baseInput.sourceText?.trim()) {
            throw new Error(`No readable source text is available. ${baseInput.sourceLimitations.join(' ')}`)
          }
          if (input.mode === 'source_grounded') {
            const [orderedInput, sourceProfile] = await Promise.all([
              orderSourceGroundedInput(baseInput),
              analyzeSourceProfile({ goals: baseInput.goals, sourceText: baseInput.sourceText ?? '' }),
            ])
            input = { ...orderedInput, sourceProfile }
          } else {
            input = baseInput
          }
          completedStages.push('extracting_sources')
          await updateStage('extracting_sources', 'Sources analyzed: teaching style extracted and order inferred.', completedStages, { input })
        }

        // Stage 3: researching_curriculum
        if (input.mode === 'ai_teacher' && !completedStages.includes('researching_curriculum')) {
          await updateStage('researching_curriculum', 'Searching curriculum insights and references...', completedStages)
          let researchReport = currentJob.researchReport
          if (!researchReport) {
            researchReport = await researchCurriculum({
              goals: input.goals,
              courseDepth: input.courseDepth,
              learningControl: input.learningControl,
            })
          }
          completedStages.push('researching_curriculum')
          await updateStage('researching_curriculum', 'Research completed.', completedStages, { researchReport })
        }

        currentJob = await db.collection('generationJobs').findOne({ _id: jobId, user_id: userId })

        // Stage 4: building_curriculum
        if (!completedStages.includes('building_curriculum')) {
          await updateStage('building_curriculum', 'Generating branch structures, topics, and milestones...', completedStages)
          let curriculum = currentJob.curriculum
          if (!curriculum) {
            const curriculumPrompt = curriculumBuilderSkill({
              ...input,
              curriculumResearchBrief: formatResearchBrief(currentJob.researchReport || null),
            })
            const curriculumText = await generateAI({ feature: 'curriculum_generation', ...curriculumPrompt })
            curriculum = parseAIJson<any>(curriculumText)
          }
          completedStages.push('building_curriculum')
          await updateStage('building_curriculum', 'Curriculum built successfully.', completedStages, { curriculum })
        }

        currentJob = await db.collection('generationJobs').findOne({ _id: jobId, user_id: userId })

        // Curriculum preview gate: pause here so the learner can review and edit the
        // roadmap before we commit to building the atlas, traccia, and pages. The job
        // resumes from this exact point once the curriculum is approved (the approval
        // endpoint sets curriculum_approved + status:running and the client reconnects).
        if (input.previewCurriculum !== false && !currentJob?.curriculum_approved) {
          if (!isClosed) {
            const awaitingJob = await updateJobStage(
              db,
              jobId,
              userId,
              'awaiting_curriculum_approval',
              'Curriculum ready for your review.',
              completedStages,
              { status: 'awaiting_approval' },
            )
            if (awaitingJob) {
              sendSSE(controller, 'update', awaitingJob)
            }
          }
          clearInterval(heartbeatInterval)
          try { controller.close() } catch (e) {}
          isClosed = true
          return
        }

        // Stage 5: building_atlas
        if (!completedStages.includes('building_atlas')) {
          await updateStage('building_atlas', 'Mapping prerequisites and dependency connections...', completedStages)
          let map = currentJob.map
          if (!map) {
            const mapText = await generateAI({ feature: 'map_generation', ...mapBuilderSkill(currentJob.curriculum) })
            map = parseAIJson<any>(mapText)
          }
          completedStages.push('building_atlas')
          await updateStage('building_atlas', 'Atlas mapping completed.', completedStages, { map })
        }

        currentJob = await db.collection('generationJobs').findOne({ _id: jobId, user_id: userId })

        // Stage 6: building_traccia
        if (!completedStages.includes('building_traccia')) {
          await updateStage('building_traccia', 'Ordering topics so each idea prepares you for the next...', completedStages)
          let learningStyle = currentJob.learningStyle
          let learningStyleReason = currentJob.learningStyleReason
          if (!learningStyle && input.teachingStyle && input.teachingStyle !== 'auto') {
            // The student picked a teaching style at setup — skip the classifier.
            learningStyle = input.teachingStyle
            learningStyleReason = 'Chosen by the student at course setup.'
          }
          if (!learningStyle) {
            const branchTitles = Array.isArray(currentJob.curriculum?.branches)
              ? currentJob.curriculum.branches.map((b: any) => String(b?.title ?? '')).filter(Boolean)
              : []
            const styleResult = await determineLessonStyle(input.goals, currentJob.curriculum?.title ?? input.topic, branchTitles)
            learningStyle = styleResult.style
            learningStyleReason = styleResult.reason
          }
          completedStages.push('building_traccia')
          await updateStage('building_traccia', 'Traccia sequence built.', completedStages, { learningStyle, learningStyleReason })
        }

        currentJob = await db.collection('generationJobs').findOne({ _id: jobId, user_id: userId })

        // Stage 7: connecting_prerequisites
        if (!completedStages.includes('connecting_prerequisites')) {
          await updateStage('connecting_prerequisites', 'Finalizing course dependency logic...', completedStages)
          completedStages.push('connecting_prerequisites')
          await updateStage('connecting_prerequisites', 'Prerequisites connected.', completedStages)
        }

        // Stage 8: persisting_course
        if (!completedStages.includes('persisting_course')) {
          await updateStage('persisting_course', 'Storing curriculum, pages, and maps into MongoDB...', completedStages)
          let courseId = currentJob.course_id
          let firstTopicId = currentJob.firstTopicId
          if (!courseId) {
            const persisted = await persistGeneratedCourse({
              ...input,
              curriculum: currentJob.curriculum,
              map: currentJob.map,
              learningStyle: currentJob.learningStyle as any,
              learningStyleReason: currentJob.learningStyleReason,
              researchReport: currentJob.researchReport,
              userId,
              generationJobId: jobId,
            })
            courseId = persisted.courseId
            firstTopicId = persisted.firstTopicId
          }
          completedStages.push('persisting_course')
          await updateStage('persisting_course', 'Course persisted successfully.', completedStages, { course_id: courseId, firstTopicId })
        }

        currentJob = await db.collection('generationJobs').findOne({ _id: jobId, user_id: userId })

        // Stage 9: preparing_workspace
        if (!completedStages.includes('preparing_workspace')) {
          await updateStage('preparing_workspace', 'Setting up your customized course workspace...', completedStages)
          completedStages.push('preparing_workspace')
          await updateStage('preparing_workspace', 'Workspace prepared.', completedStages)
        }

        // Final Stage: completed
        if (!completedStages.includes('completed')) {
          completedStages.push('completed')
          const finalJob = await updateJobStage(db, jobId, userId, 'completed', 'Your Atlas is ready.', completedStages, {
            status: 'completed',
            completed_at: new Date(),
          })
          if (finalJob) {
            sendSSE(controller, 'update', finalJob)
          }
        }

        clearInterval(heartbeatInterval)
        try { controller.close(); } catch(e) {}
        isClosed = true
      } catch (err) {
        clearInterval(heartbeatInterval)
        console.error('[generation-jobs] SSE generation failed:', err)
        const errMsg = err instanceof Error ? err.message : 'Course generation failed'
        const code = (err as any).code || null

        const updateData: any = {
          status: 'failed',
          error: errMsg,
          updated_at: new Date(),
        }
        if (code) {
          updateData.error_code = code
        }

        await db.collection('generationJobs').updateOne(
          { _id: jobId, user_id: userId },
          { $set: updateData }
        )

        const finalFailedJob = await db.collection('generationJobs').findOne({ _id: jobId, user_id: userId })
        if (finalFailedJob) {
          sendSSE(controller, 'update', finalFailedJob)
        }

        try { controller.close(); } catch(e) {}
        isClosed = true
      }
    },
    cancel() {
      isClosed = true
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    }
  })
}
