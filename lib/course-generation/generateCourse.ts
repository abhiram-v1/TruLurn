import { generateWithGemini } from '@/lib/ai/gemini/client'
import { parseGeminiJson } from '@/lib/ai/gemini/json'
import { curriculumBuilderSkill, mapBuilderSkill } from '@/lib/ai/skills'
import { persistGeneratedCourse } from '@/lib/course-generation/mongoPersistence'
import type { CourseGenerationInput } from '@/lib/course-generation/input'

export type GeneratedCourseResult = {
  courseId: string
  firstTopicId: string
  sourceLimitations: string[]
}

export async function generateAndPersistCourse(input: CourseGenerationInput & { userId: string }): Promise<GeneratedCourseResult> {
  const curriculumPrompt = curriculumBuilderSkill(input)
  const curriculumText = await generateWithGemini({ ...curriculumPrompt, purpose: 'primary' })
  const curriculum = parseGeminiJson<unknown>(curriculumText)

  const mapPrompt = mapBuilderSkill(curriculum)
  const mapText = await generateWithGemini({ ...mapPrompt, purpose: 'primary' })
  const map = parseGeminiJson<unknown>(mapText)

  const persisted = await persistGeneratedCourse({
    ...input,
    curriculum,
    map,
  })

  return {
    ...persisted,
    sourceLimitations: input.sourceLimitations,
  }
}
