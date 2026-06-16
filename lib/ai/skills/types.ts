export type AISkillName =
  | 'curriculum_builder'
  | 'map_builder'
  | 'flow_tracker'
  | 'scoped_chat'
  | 'source_learning_page'
  | 'data_chart'

export type SkillPrompt = {
  name: AISkillName
  system: string
  user: string
}

/** @deprecated Use AISkillName. */
export type GeminiSkillName = AISkillName

export type CurriculumMode = 'ai_teacher' | 'source_grounded'
export type LearningControlMode = 'guided' | 'balanced' | 'open'
export type CourseDepth = 'low' | 'standard' | 'high'
export type KnowledgeLevel = 'beginner' | 'intermediate' | 'expert'
export type LearningPurpose = 'explorer' | 'practitioner' | 'researcher'

export type CurriculumSkillInput = {
  topic: string
  goals: string
  mode: CurriculumMode
  learningControl: LearningControlMode
  courseDepth: CourseDepth
  knowledgeLevel?: KnowledgeLevel
  learningPurpose?: LearningPurpose
  teachingPersona?: import('@/lib/personas').TeachingPersonaId
  sourceText?: string
  sourceOrderAnalysis?: string
  sourceProfile?: import('@/lib/course-generation/sourceProfile').SourceTeachingProfile | null
  curriculumResearchBrief?: string
}

export type ScopedChatSkillInput = {
  topicTitle: string
  pageNumber: number
  pageContent: string
  userQuestion: string
}
