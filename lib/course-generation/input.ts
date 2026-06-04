import type { CourseDepth, CurriculumMode, LearningControlMode } from '@/lib/ai/skills/types'
import { extractSourceTextFromFormData, normalizeCurriculumMode } from '@/lib/ai/sources'

export type CourseGenerationInput = {
  topic: string          // derived from goals — kept for backward compat with persistence
  goals: string          // the user's full learning description (primary input)
  mode: CurriculumMode
  learningControl: LearningControlMode
  courseDepth: CourseDepth
  sourceText?: string
  sourceLimitations: string[]
}

type RawCourseGenerationInput = {
  goals?: string
  mode?: CurriculumMode
  learningControl?: LearningControlMode
  courseDepth?: CourseDepth
  sourceText?: string
}

function normalizeLearningControlMode(value: unknown): LearningControlMode {
  if (value === 'guided' || value === 'balanced' || value === 'open') return value
  return 'balanced'
}

function normalizeCourseDepth(value: unknown): CourseDepth {
  if (value === 'low' || value === 'standard' || value === 'high') return value
  return 'standard'
}

export async function readCourseGenerationInput(request: Request): Promise<CourseGenerationInput> {
  const contentType = request.headers.get('content-type') ?? ''

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData()
    const extracted = await extractSourceTextFromFormData(formData)
    const goals = String(formData.get('goals') ?? '').trim()

    return normalizeCourseGenerationInput({
      goals,
      mode: normalizeCurriculumMode(formData.get('mode')),
      learningControl: normalizeLearningControlMode(formData.get('learningControl')),
      courseDepth: normalizeCourseDepth(formData.get('courseDepth')),
      sourceText: extracted.sourceText,
      sourceLimitations: extracted.limitations,
    })
  }

  const body = (await request.json()) as RawCourseGenerationInput

  return normalizeCourseGenerationInput({
    ...body,
    mode: normalizeCurriculumMode(body.mode),
    learningControl: normalizeLearningControlMode(body.learningControl),
    courseDepth: normalizeCourseDepth(body.courseDepth),
    sourceLimitations: [],
  })
}

function normalizeCourseGenerationInput(input: {
  goals?: string
  mode?: CurriculumMode
  learningControl?: LearningControlMode
  courseDepth?: CourseDepth
  sourceText?: string
  sourceLimitations: string[]
}): CourseGenerationInput {
  const goals = input.goals?.trim() ?? ''
  return {
    topic: goals,   // topic = goals for storage/search; AI generates the real title
    goals,
    mode: input.mode ?? 'ai_teacher',
    learningControl: input.learningControl ?? 'balanced',
    courseDepth: input.courseDepth ?? 'standard',
    sourceText: input.sourceText?.trim() || undefined,
    sourceLimitations: input.sourceLimitations,
  }
}

export function validateCourseGenerationInput(input: CourseGenerationInput): string | null {
  if (!input.goals || input.goals.length < 10) return 'Please describe what you want to learn (at least a sentence).'
  if (input.mode === 'source_grounded' && !input.sourceText) {
    return 'Source-grounded mode needs at least one readable source file.'
  }
  return null
}
