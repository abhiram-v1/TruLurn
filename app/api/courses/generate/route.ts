import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { readCourseGenerationInput, validateCourseGenerationInput } from '@/lib/course-generation/input'
import { getRequiredUserId } from '@/lib/server/currentUser'
import crypto from 'crypto'

export async function POST(request: Request) {
  try {
    const userId = await getRequiredUserId()
    const input = await readCourseGenerationInput(request)
    const validationError = validateCourseGenerationInput(input)

    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    const db = await getDb()
    const jobId = crypto.randomUUID()

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
        sourceText: input.sourceText || null,
        sourceLimitations: input.sourceLimitations || [],
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
