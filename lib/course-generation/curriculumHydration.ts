import type { CourseGenerationInput } from './input.ts'
import { enforceSourceGroundedCurriculum } from './sourceCurriculumIntegrity.ts'

function collectTopics(curriculum: any) {
  const topics: any[] = []
  const visit = (topic: any) => {
    if (!topic || typeof topic !== 'object') return
    topics.push(topic)
    for (const child of Array.isArray(topic.children) ? topic.children : []) visit(child)
  }
  for (const branch of Array.isArray(curriculum?.branches) ? curriculum.branches : []) {
    for (const section of Array.isArray(branch?.sections) ? branch.sections : []) {
      for (const topic of Array.isArray(section?.topics) ? section.topics : []) visit(topic)
    }
  }
  return topics
}

export function hydrateCurriculumDefaults(
  curriculum: any,
  input: CourseGenerationInput,
) {
  if (!curriculum || typeof curriculum !== 'object') return curriculum

  for (const branch of Array.isArray(curriculum.branches) ? curriculum.branches : []) {
    branch.state = 'not_started'
  }

  collectTopics(curriculum).forEach((topic, index) => {
    topic.initial_state = index === 0 ? 'active' : 'locked'
  })

  curriculum.source_limitations = [...(input.sourceLimitations ?? [])]
  return curriculum
}

export function finalizeCurriculum(
  curriculum: any,
  input: CourseGenerationInput,
) {
  hydrateCurriculumDefaults(curriculum, input)
  if (input.mode !== 'source_grounded') return curriculum

  return enforceSourceGroundedCurriculum(curriculum, {
    sourceText: input.sourceText,
    sourceProfile: input.sourceProfile,
    compactCurriculumSource: input.compactCurriculumSource,
  })
}
