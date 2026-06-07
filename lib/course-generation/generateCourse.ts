import { generateWithGemini } from '@/lib/ai/gemini/client'
import { parseGeminiJson } from '@/lib/ai/gemini/json'
import { curriculumBuilderSkill, mapBuilderSkill } from '@/lib/ai/skills'
import { persistGeneratedCourse } from '@/lib/course-generation/mongoPersistence'
import { determineLessonStyle } from '@/lib/ai/skills/lessonStyle'
import { formatResearchBrief, researchCurriculum, type CourseResearchReport } from '@/lib/course-generation/research'
import type { CourseGenerationInput } from '@/lib/course-generation/input'

export type GeneratedCourseResult = {
  courseId: string
  firstTopicId: string
  sourceLimitations: string[]
}

export async function generateAndPersistCourse(input: CourseGenerationInput & { userId: string }): Promise<GeneratedCourseResult> {
  let researchReport: CourseResearchReport | null = null

  if (input.mode === 'ai_teacher') {
    researchReport = await researchCurriculum({
      goals: input.goals,
      courseDepth: input.courseDepth,
      learningControl: input.learningControl,
    })
  }

  const curriculumPrompt = curriculumBuilderSkill({
    ...input,
    curriculumResearchBrief: formatResearchBrief(researchReport),
  })
  const curriculumText = await generateWithGemini({ ...curriculumPrompt, purpose: 'primary' })
  const curriculum = parseGeminiJson<any>(curriculumText)

  // Run map build and style determination in parallel — both only need the curriculum
  const branchTitles = Array.isArray(curriculum?.branches)
    ? curriculum.branches.map((b: any) => String(b?.title ?? '')).filter(Boolean)
    : []

  const [mapText, styleResult] = await Promise.all([
    generateWithGemini({ ...mapBuilderSkill(curriculum), purpose: 'primary' }),
    determineLessonStyle(input.goals, curriculum?.title ?? input.topic, branchTitles),
  ])

  const map = parseGeminiJson<unknown>(mapText)

  const persisted = await persistGeneratedCourse({
    ...input,
    curriculum,
    map,
    learningStyle: styleResult.style,
    learningStyleReason: styleResult.reason,
    researchReport,
  })

  return {
    ...persisted,
    sourceLimitations: input.sourceLimitations,
  }
}
