import type { CurriculumMode } from '@/lib/ai/skills/types'
import { extractSourceTextFromFormData, normalizeCurriculumMode } from '@/lib/ai/sources'

export type CourseGenerationInput = {
  topic: string
  goals: string
  mode: CurriculumMode
  sourceText?: string
  sourceLimitations: string[]
}

type RawCourseGenerationInput = {
  topic?: string
  goals?: string
  mode?: CurriculumMode
  sourceText?: string
}

export async function readCourseGenerationInput(request: Request): Promise<CourseGenerationInput> {
  const contentType = request.headers.get('content-type') ?? ''

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData()
    const extracted = await extractSourceTextFromFormData(formData)

    return normalizeCourseGenerationInput({
      topic: String(formData.get('topic') ?? ''),
      goals: String(formData.get('goals') ?? ''),
      mode: normalizeCurriculumMode(formData.get('mode')),
      sourceText: extracted.sourceText,
      sourceLimitations: extracted.limitations,
    })
  }

  const body = (await request.json()) as RawCourseGenerationInput

  return normalizeCourseGenerationInput({
    ...body,
    mode: normalizeCurriculumMode(body.mode),
    sourceLimitations: [],
  })
}

function normalizeCourseGenerationInput(input: {
  topic?: string
  goals?: string
  mode?: CurriculumMode
  sourceText?: string
  sourceLimitations: string[]
}): CourseGenerationInput {
  return {
    topic: input.topic?.trim() ?? '',
    goals: input.goals?.trim() ?? '',
    mode: input.mode ?? 'ai_teacher',
    sourceText: input.sourceText?.trim() || undefined,
    sourceLimitations: input.sourceLimitations,
  }
}

export function validateCourseGenerationInput(input: CourseGenerationInput): string | null {
  if (input.topic.length < 3) return 'Topic must be at least 3 characters.'
  if (!input.goals) return 'Goals are required.'
  if (input.mode === 'source_grounded' && !input.sourceText) {
    return 'Source-grounded mode needs at least one readable source file or sourceText value.'
  }

  return null
}
