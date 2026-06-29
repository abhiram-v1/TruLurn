export type AISkillName =
  | 'curriculum_builder'
  | 'flow_tracker'
  | 'scoped_chat'
  | 'source_learning_page'
  | 'data_chart'

export type SkillPrompt = {
  name: AISkillName
  system: string
  user: string
  responseMimeType?: 'application/json' | 'text/plain'
  /**
   * A static schema applies to every provider unchanged. A resolver function
   * is called with the provider that will actually serve the request, so
   * skills whose schema differs by provider dialect (e.g. OpenAI strict mode
   * rejecting open-ended dictionaries that Gemini accepts) can return the
   * correct shape per provider rather than one schema forced onto both.
   */
  responseSchema?:
    | import('@/lib/ai/types').AIResponseSchema
    | ((provider: import('@/lib/ai/types').AIProviderName) => import('@/lib/ai/types').AIResponseSchema | undefined)
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
  sourceProfile?: import('@/lib/course-generation/sourceProfile').SourceProfileEnvelope | import('@/lib/course-generation/sourceProfile').SourceTeachingProfile | null
  compactCurriculumSource?: import('@/lib/course-generation/sourceCompaction').CompactCurriculumSource | null
  curriculumResearchBrief?: string
}

export type ScopedChatSkillInput = {
  topicTitle: string
  pageNumber: number
  pageContent: string
  userQuestion: string
}
