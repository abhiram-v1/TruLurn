export type TeachingPersonaId = 'immersive_builder' | 'investigator'

export type PersonaSurface = 'lesson' | 'agent' | 'quiz' | 'recall'

export type ImmersiveBuilderPageType =
  | 'major_concept'
  | 'technical'
  | 'continuation'
  | 'support'
  | 'mathematical'

export type InvestigatorPageType =
  | 'major_mystery'
  | 'failure_analysis'
  | 'technical_definition'
  | 'mathematical_mechanism'
  | 'continuation'
  | 'support'

export type PersonaLessonContext = {
  contentKind?: string | null
  sequenceRole?: string | null
  pageNumber?: number | null
  topicDepth?: string | null
  targetLength?: string | null
  focus?: string | null
  targetUnderstanding?: string | null
  representationPlan?: string[] | null
  continuesFromPrevious?: boolean
  continuesToNext?: boolean
  targetWords?: number | null
  softMaxWords?: number | null
}

export type TeachingPersonaDefinition = {
  id: TeachingPersonaId
  name: string
  version: number
  summary: string
}
