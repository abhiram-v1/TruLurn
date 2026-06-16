export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { validateTopicSuitability } from '@/lib/course-generation/topicValidator'
import { researchCurriculum, formatResearchBrief } from '@/lib/course-generation/research'
import { curriculumBuilderSkill, mapBuilderSkill } from '@/lib/ai/skills'
import { generateAI, parseAIJson } from '@/lib/ai'
import { persistGeneratedCourse } from '@/lib/course-generation/mongoPersistence'
import { orderSourceGroundedInput } from '@/lib/course-generation/sourceOrdering'
import { analyzeSourceProfile } from '@/lib/course-generation/sourceProfile'
import { readIngestedSourceText, resumeSourceIngestionJobs } from '@/lib/sources/ingestion'
import { sanitizeGeneratedMap } from '@/lib/course-generation/generateCourse'
import {
  enforceSourceGroundedCurriculum,
  enforceSourceGroundedMap,
} from '@/lib/course-generation/sourceCurriculumIntegrity'
import { deriveLearnerAudience } from '@/lib/personalization/learnerAudience'
import crypto from 'crypto'

const UNSUITABLE_MESSAGE =
  'This topic is not suitable for structured course creation. Please enter a subject that can be taught through multiple lessons, such as programming, mathematics, design, business, science, languages, or other professional skills.'
const WORKER_LEASE_MS = 90_000
const WORKER_LEASE_RENEW_MS = 25_000

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
  extraData?: any,
  workerRunId?: string,
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
      ...(workerRunId ? { worker_lease_expires_at: new Date(Date.now() + WORKER_LEASE_MS) } : {}),
    }
  }

  if (extraData) {
    Object.assign(update.$set, extraData)
  }

  const write = await db.collection('generationJobs').updateOne(
    {
      _id: jobId,
      user_id: userId,
      ...(workerRunId ? { worker_run_id: workerRunId } : {}),
    },
    update
  )
  if (workerRunId && write.matchedCount === 0) {
    throw new Error('Generation worker ownership was lost before the stage could be saved.')
  }

  const job = await db.collection('generationJobs').findOne({ _id: jobId, user_id: userId })
  return job
}

async function claimWorker(db: any, jobId: string, userId: string) {
  const workerRunId = crypto.randomUUID()
  const now = new Date()
  const claimed = await db.collection('generationJobs').findOneAndUpdate(
    {
      _id: jobId,
      user_id: userId,
      status: { $in: ['queued', 'running'] },
      $or: [
        { worker_lease_expires_at: { $exists: false } },
        { worker_lease_expires_at: { $lte: now } },
      ],
    },
    {
      $set: {
        status: 'running',
        worker_run_id: workerRunId,
        worker_lease_expires_at: new Date(now.getTime() + WORKER_LEASE_MS),
        updated_at: now,
      },
    },
    { returnDocument: 'after' },
  )
  return claimed.value ? { job: claimed.value, workerRunId } : null
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
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
      let leaseRenewalInterval: NodeJS.Timeout | null = null
      let activeWorkerRunId: string | null = null

      async function updateStage(
        stage: string,
        message: string,
        completedStages: string[],
        extra?: any,
        workerRunId?: string,
      ) {
        const updated = await updateJobStage(
          db,
          jobId,
          userId,
          stage,
          message,
          completedStages,
          extra,
          workerRunId,
        )
        if (updated && !isClosed) {
          sendSSE(controller, 'update', updated)
        }
      }

      try {
        let currentJob = await db.collection('generationJobs').findOne({ _id: jobId, user_id: userId })
        if (!currentJob) {
          throw new Error('Job not found')
        }

        // Terminal and review-gate states never start a worker.
        if (
          currentJob.status === 'completed'
          || currentJob.status === 'failed'
          || currentJob.status === 'awaiting_approval'
        ) {
          sendSSE(controller, 'update', currentJob)
          clearInterval(heartbeatInterval)
          try { controller.close(); } catch(e) {}
          isClosed = true
          return
        }

        const claim = await claimWorker(db, jobId, userId)
        if (!claim) {
          // Another connection already owns the paid work. Mirror its durable
          // progress instead of starting a second model pipeline.
          let lastUpdatedAt = Number(new Date(currentJob.updated_at ?? 0))
          while (!isClosed) {
            await sleep(1_000)
            const observed = await db.collection('generationJobs').findOne({ _id: jobId, user_id: userId })
            if (!observed) break
            const updatedAt = Number(new Date(observed.updated_at ?? 0))
            if (updatedAt !== lastUpdatedAt) {
              sendSSE(controller, 'update', observed)
              lastUpdatedAt = updatedAt
            }
            if (['completed', 'failed', 'awaiting_approval'].includes(String(observed.status))) break
          }
          clearInterval(heartbeatInterval)
          if (!isClosed) {
            try { controller.close() } catch (e) {}
            isClosed = true
          }
          return
        }
        currentJob = claim.job
        const workerRunId = claim.workerRunId
        activeWorkerRunId = workerRunId
        leaseRenewalInterval = setInterval(() => {
          void db.collection('generationJobs').updateOne(
            { _id: jobId, user_id: userId, worker_run_id: workerRunId },
            {
              $set: {
                worker_lease_expires_at: new Date(Date.now() + WORKER_LEASE_MS),
                updated_at: new Date(),
              },
            },
          ).catch(() => {})
        }, WORKER_LEASE_RENEW_MS)

        // Run worker logic
        let input = currentJob.input
        const completedStages = currentJob.completed_stages || []

        // Stage 1: validating_input
        if (!completedStages.includes('validating_input')) {
          await updateStage('validating_input', 'Reviewing course topic and goals...', completedStages, undefined, workerRunId)
          if (input.mode !== 'source_grounded') {
            const suitability = await validateTopicSuitability(input.goals)
            if (!suitability.valid) {
              const err = new Error(UNSUITABLE_MESSAGE)
              ;(err as any).code = 'TOPIC_UNSUITABLE'
              throw err
            }
          }
          completedStages.push('validating_input')
          await updateStage('validating_input', 'Input validated.', completedStages, undefined, workerRunId)
        }

        // Stage 2: extracting_sources
        // Ordering rewrites the source sequence; profiling learns how the material
        // teaches and which full subject it belongs to. Independent — run in parallel.
        if ((input.mode === 'source_grounded' || input.sourceIngestionJobIds?.length) && !completedStages.includes('extracting_sources')) {
          await updateStage('extracting_sources', 'Studying how your material teaches and inferring source order...', completedStages, undefined, workerRunId)
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
          await updateStage('extracting_sources', 'Sources analyzed: structure, terminology, and order inferred.', completedStages, { input }, workerRunId)
        }

        // Stage 3: researching_curriculum
        if (input.mode === 'ai_teacher' && !completedStages.includes('researching_curriculum')) {
          await updateStage('researching_curriculum', 'Searching curriculum insights and references...', completedStages, undefined, workerRunId)
          let researchReport = currentJob.researchReport
          if (!researchReport) {
            researchReport = await researchCurriculum({
              goals: input.goals,
              courseDepth: input.courseDepth,
              learningControl: input.learningControl,
            })
          }
          completedStages.push('researching_curriculum')
          await updateStage('researching_curriculum', 'Research completed.', completedStages, { researchReport }, workerRunId)
        }

        currentJob = await db.collection('generationJobs').findOne({ _id: jobId, user_id: userId })

        // Stage 4: building_curriculum
        if (!completedStages.includes('building_curriculum')) {
          await updateStage('building_curriculum', 'Generating branch structures, topics, and milestones...', completedStages, undefined, workerRunId)
          let curriculum = currentJob.curriculum
          if (!curriculum) {
            const curriculumPrompt = curriculumBuilderSkill({
              ...input,
              curriculumResearchBrief: formatResearchBrief(currentJob.researchReport || null),
            })
            const curriculumText = await generateAI({ feature: 'curriculum_generation', ...curriculumPrompt })
            curriculum = parseAIJson<any>(curriculumText)
          }
          if (input.mode === 'source_grounded') {
            curriculum = enforceSourceGroundedCurriculum(curriculum, {
              sourceText: input.sourceText,
              sourceProfile: input.sourceProfile,
            })
          }
          completedStages.push('building_curriculum')
          await updateStage('building_curriculum', 'Curriculum built successfully.', completedStages, { curriculum }, workerRunId)
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
              workerRunId,
            )
            if (awaitingJob) {
              sendSSE(controller, 'update', awaitingJob)
            }
          }
          await db.collection('generationJobs').updateOne(
            { _id: jobId, user_id: userId, worker_run_id: workerRunId },
            { $unset: { worker_run_id: '', worker_lease_expires_at: '' } },
          )
          if (leaseRenewalInterval) clearInterval(leaseRenewalInterval)
          clearInterval(heartbeatInterval)
          try { controller.close() } catch (e) {}
          isClosed = true
          return
        }

        // Stage 5: building_atlas
        if (!completedStages.includes('building_atlas')) {
          await updateStage('building_atlas', 'Mapping prerequisites and dependency connections...', completedStages, undefined, workerRunId)
          let map = currentJob.map
          if (!map) {
            const mapText = await generateAI({ feature: 'map_generation', ...mapBuilderSkill(currentJob.curriculum) })
            map = parseAIJson<any>(mapText)
          }
          sanitizeGeneratedMap(map, currentJob.curriculum)
          if (input.mode === 'source_grounded') {
            enforceSourceGroundedMap(currentJob.curriculum, map)
          }
          completedStages.push('building_atlas')
          await updateStage('building_atlas', 'Atlas mapping completed.', completedStages, { map }, workerRunId)
        }

        currentJob = await db.collection('generationJobs').findOne({ _id: jobId, user_id: userId })

        // Stage 6: building_traccia
        if (!completedStages.includes('building_traccia')) {
          await updateStage('building_traccia', 'Ordering topics so each idea prepares you for the next...', completedStages, undefined, workerRunId)
          const learnerAudience = currentJob.learnerAudience ?? await deriveLearnerAudience({
            goals: input.goals,
            knowledgeLevel: input.knowledgeLevel,
            learningPurpose: input.learningPurpose,
            sourceProfile: currentJob.sourceProfile ?? null,
          })
          completedStages.push('building_traccia')
          await updateStage('building_traccia', 'Traccia sequence built.', completedStages, {
            teachingPersona: input.teachingPersona,
            learnerAudience,
          }, workerRunId)
        }

        currentJob = await db.collection('generationJobs').findOne({ _id: jobId, user_id: userId })

        // Stage 7: connecting_prerequisites
        if (!completedStages.includes('connecting_prerequisites')) {
          await updateStage('connecting_prerequisites', 'Finalizing course dependency logic...', completedStages, undefined, workerRunId)
          completedStages.push('connecting_prerequisites')
          await updateStage('connecting_prerequisites', 'Prerequisites connected.', completedStages, undefined, workerRunId)
        }

        // Stage 8: persisting_course
        if (!completedStages.includes('persisting_course')) {
          await updateStage('persisting_course', 'Storing curriculum, pages, and maps into MongoDB...', completedStages, undefined, workerRunId)
          let courseId = currentJob.course_id
          let firstTopicId = currentJob.firstTopicId
          if (!courseId) {
            const persisted = await persistGeneratedCourse({
              ...input,
              curriculum: currentJob.curriculum,
              map: currentJob.map,
              teachingPersona: currentJob.teachingPersona ?? input.teachingPersona,
              learnerAudience: currentJob.learnerAudience ?? null,
              researchReport: currentJob.researchReport,
              userId,
              generationJobId: jobId,
            })
            courseId = persisted.courseId
            firstTopicId = persisted.firstTopicId
          }
          completedStages.push('persisting_course')
          await updateStage('persisting_course', 'Course persisted successfully.', completedStages, { course_id: courseId, firstTopicId }, workerRunId)
        }

        currentJob = await db.collection('generationJobs').findOne({ _id: jobId, user_id: userId })

        // Stage 9: preparing_workspace
        if (!completedStages.includes('preparing_workspace')) {
          await updateStage('preparing_workspace', 'Setting up your customized course workspace...', completedStages, undefined, workerRunId)
          completedStages.push('preparing_workspace')
          await updateStage('preparing_workspace', 'Workspace prepared.', completedStages, undefined, workerRunId)
        }

        // Final Stage: completed
        if (!completedStages.includes('completed')) {
          completedStages.push('completed')
          const finalJob = await updateJobStage(db, jobId, userId, 'completed', 'Your Atlas is ready.', completedStages, {
            status: 'completed',
            completed_at: new Date(),
          }, workerRunId)
          if (finalJob && !isClosed) {
            sendSSE(controller, 'update', finalJob)
          }
        }

        if (leaseRenewalInterval) clearInterval(leaseRenewalInterval)
        await db.collection('generationJobs').updateOne(
          { _id: jobId, user_id: userId, worker_run_id: workerRunId },
          { $unset: { worker_run_id: '', worker_lease_expires_at: '' } },
        )
        clearInterval(heartbeatInterval)
        if (!isClosed) {
          try { controller.close(); } catch(e) {}
        }
        isClosed = true
      } catch (err) {
        clearInterval(heartbeatInterval)
        if (leaseRenewalInterval) clearInterval(leaseRenewalInterval)
        console.error('[generation-jobs] SSE generation failed:', err)
        if (!activeWorkerRunId) {
          if (!isClosed) {
            try { controller.close() } catch (e) {}
            isClosed = true
          }
          return
        }
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
          { _id: jobId, user_id: userId, worker_run_id: activeWorkerRunId },
          {
            $set: updateData,
            $unset: { worker_run_id: '', worker_lease_expires_at: '' },
          }
        )

        const finalFailedJob = await db.collection('generationJobs').findOne({ _id: jobId, user_id: userId })
        if (finalFailedJob && !isClosed) {
          sendSSE(controller, 'update', finalFailedJob)
        }

        if (!isClosed) {
          try { controller.close(); } catch(e) {}
        }
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
