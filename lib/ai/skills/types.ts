export type GeminiSkillName =
  | 'curriculum_builder'
  | 'map_builder'
  | 'flow_tracker'
  | 'scoped_chat'
  | 'source_learning_page'

export type SkillPrompt = {
  name: GeminiSkillName
  system: string
  user: string
}

export type CurriculumMode = 'ai_teacher' | 'source_grounded'
export type LearningControlMode = 'guided' | 'balanced' | 'open'
export type CourseDepth = 'low' | 'standard' | 'high'

export type CurriculumSkillInput = {
  topic: string
  goals: string
  mode: CurriculumMode
  learningControl: LearningControlMode
  courseDepth: CourseDepth
  sourceText?: string
}

export type ScopedChatSkillInput = {
  topicTitle: string
  pageNumber: number
  pageContent: string
  userQuestion: string
}
