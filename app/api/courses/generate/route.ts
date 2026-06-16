import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { readCourseGenerationInput, validateCourseGenerationInput } from '@/lib/course-generation/input'
import { getRequiredUserId } from '@/lib/server/currentUser'
import crypto from 'crypto'
import { ensureLexicalSearchIndexes, ensureVectorSearchIndexes } from '@/lib/vector/indexes'

export async function POST(request: Request) {
  try {
    const userId = await getRequiredUserId()
    const db = await getDb()
    const jobId = crypto.randomUUID()
    const [vectorIndexes, lexicalIndexes] = await Promise.all([
      ensureVectorSearchIndexes(db),
      ensureLexicalSearchIndexes(db),
    ])
    const indexErrors = [...vectorIndexes, ...lexicalIndexes]
      .filter((index) => index.status === 'error')
    if (indexErrors.length) {
      console.warn('[course-generation] Vector index setup reported errors.', indexErrors)
    }
    const input = await readCourseGenerationInput(request, {
      db,
      userId,
      generationJobId: jobId,
    })
    const validationError = validateCourseGenerationInput(input)

    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    const jobDoc = {
      _id: jobId,
      user_id: userId,
      status: 'queued',
      stage: 'validating_input',
      stage_label: 'Validating Input',
      message: 'Reviewing course topic and goals...',
      completed_stages: [],
      course_id: null,
      error: null,
      input: {
        goals: input.goals,
        mode: input.mode,
        learningControl: input.learningControl,
        courseDepth: input.courseDepth,
        knowledgeLevel: input.knowledgeLevel,
        learningPurpose: input.learningPurpose,
        teachingPersona: input.teachingPersona,
        previewCurriculum: input.previewCurriculum,
        sourceText: input.sourceText || null,
        sourceLimitations: input.sourceLimitations || [],
        sourceDocumentIds: input.sourceDocumentIds || [],
        sourceVersionIds: input.sourceVersionIds || [],
        sourceIngestionJobIds: input.sourceIngestionJobIds || [],
      },
      created_at: new Date(),
      updated_at: new Date(),
    }

    await db.collection('generationJobs').insertOne(jobDoc as any)

    return NextResponse.json({
      jobId,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown course generation error'
    const status = message.includes('sign in') ? 401 : 500

    return NextResponse.json({ error: message }, { status })
  }
}
