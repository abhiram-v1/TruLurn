import type { CourseDepth, CurriculumMode, KnowledgeLevel, LearningControlMode, LearningPurpose } from '@/lib/ai/skills/types'
import type { SourceProfileEnvelope, SourceTeachingProfile } from '@/lib/course-generation/sourceProfile'
import type { CompactCurriculumSource } from '@/lib/course-generation/sourceCompaction'
import { normalizeCurriculumMode } from '@/lib/ai/sources'
import type { Db } from 'mongodb'
import { normalizeTeachingPersona, type TeachingPersonaId } from '@/lib/personas'

export const SOURCE_BASED_CURRICULA_ENABLED = false

export type CourseGenerationInput = {
  topic: string          // derived from goals — kept for backward compat with persistence
  goals: string          // the user's full learning description (primary input)
  mode: CurriculumMode
  learningControl: LearningControlMode
  courseDepth: CourseDepth
  knowledgeLevel: KnowledgeLevel
  learningPurpose: LearningPurpose
  teachingPersona: TeachingPersonaId
  previewCurriculum: boolean
  sourceText?: string
  sourceOrderAnalysis?: string
  // Teaching-style + scope-boundary analysis of the uploaded sources.
  // In source-grounded mode the sources are the hard curriculum boundary.
  sourceProfile?: SourceProfileEnvelope | SourceTeachingProfile | null
  compactCurriculumSource?: CompactCurriculumSource | null
  sourceLimitations: string[]
  sourceDocumentIds?: string[]
  sourceVersionIds?: string[]
  sourceIngestionJobIds?: string[]
}

type RawCourseGenerationInput = {
  goals?: string
  mode?: CurriculumMode
  learningControl?: LearningControlMode
  courseDepth?: CourseDepth
  knowledgeLevel?: KnowledgeLevel
  learningPurpose?: LearningPurpose
  teachingPersona?: string
  previewCurriculum?: boolean
  sourceText?: string
  sourceOrderAnalysis?: string
  sourceDocumentIds?: string[]
  sourceVersionIds?: string[]
  sourceIngestionJobIds?: string[]
}

function normalizeLearningControlMode(value: unknown): LearningControlMode {
  if (value === 'guided' || value === 'balanced' || value === 'open') return value
  return 'balanced'
}

function normalizeCourseDepth(value: unknown): CourseDepth {
  if (value === 'low' || value === 'standard' || value === 'high') return value
  return 'standard'
}

function normalizeKnowledgeLevel(value: unknown): KnowledgeLevel {
  if (value === 'beginner' || value === 'intermediate' || value === 'expert') return value
  return 'intermediate'
}

function normalizeLearningPurpose(value: unknown): LearningPurpose {
  if (value === 'explorer' || value === 'practitioner' || value === 'researcher') return value
  return 'practitioner'
}

export async function readCourseGenerationInput(
  request: Request,
  _ingestion?: { db: Db; userId: string; generationJobId: string },
): Promise<CourseGenerationInput> {
  const contentType = request.headers.get('content-type') ?? ''

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData()
    const goals = String(formData.get('goals') ?? '').trim()

    return normalizeCourseGenerationInput({
      goals,
      mode: normalizeCurriculumMode(formData.get('mode')),
      learningControl: normalizeLearningControlMode(formData.get('learningControl')),
      courseDepth: normalizeCourseDepth(formData.get('courseDepth')),
      knowledgeLevel: normalizeKnowledgeLevel(formData.get('knowledgeLevel')),
      learningPurpose: normalizeLearningPurpose(formData.get('learningPurpose')),
      teachingPersona: normalizeTeachingPersona(formData.get('teachingPersona')),
      previewCurriculum: formData.get('previewCurriculum') !== 'false',
      sourceLimitations: [],
      sourceDocumentIds: [],
      sourceVersionIds: [],
      sourceIngestionJobIds: [],
    })
  }

  const body = (await request.json()) as RawCourseGenerationInput

  return normalizeCourseGenerationInput({
    ...body,
    mode: normalizeCurriculumMode(body.mode),
    learningControl: normalizeLearningControlMode(body.learningControl),
    courseDepth: normalizeCourseDepth(body.courseDepth),
    knowledgeLevel: normalizeKnowledgeLevel(body.knowledgeLevel),
    learningPurpose: normalizeLearningPurpose(body.learningPurpose),
    teachingPersona: normalizeTeachingPersona(body.teachingPersona),
    previewCurriculum: body.previewCurriculum !== false,
    sourceLimitations: [],
  })
}

function normalizeCourseGenerationInput(input: {
  goals?: string
  mode?: CurriculumMode
  learningControl?: LearningControlMode
  courseDepth?: CourseDepth
  knowledgeLevel?: KnowledgeLevel
  learningPurpose?: LearningPurpose
  teachingPersona?: string
  previewCurriculum?: boolean
  sourceText?: string
  sourceOrderAnalysis?: string
  sourceLimitations: string[]
  sourceDocumentIds?: string[]
  sourceVersionIds?: string[]
  sourceIngestionJobIds?: string[]
}): CourseGenerationInput {
  const goals = input.goals?.trim() ?? ''
  return {
    topic: goals,   // topic = goals for storage/search; AI generates the real title
    goals,
    mode: input.mode ?? 'ai_teacher',
    learningControl: input.learningControl ?? 'balanced',
    courseDepth: input.courseDepth ?? 'standard',
    knowledgeLevel: input.knowledgeLevel ?? 'intermediate',
    learningPurpose: input.learningPurpose ?? 'practitioner',
    teachingPersona: normalizeTeachingPersona(input.teachingPersona),
    previewCurriculum: input.previewCurriculum ?? true,
    sourceText: input.sourceText?.trim() || undefined,
    sourceOrderAnalysis: input.sourceOrderAnalysis?.trim() || undefined,
    sourceLimitations: input.sourceLimitations,
    sourceDocumentIds: input.sourceDocumentIds ?? [],
    sourceVersionIds: input.sourceVersionIds ?? [],
    sourceIngestionJobIds: input.sourceIngestionJobIds ?? [],
  }
}

export function validateCourseGenerationInput(input: CourseGenerationInput): string | null {
  if (!input.goals || input.goals.length < 10) return 'Please describe what you want to learn (at least a sentence).'
  if (input.mode === 'source_grounded' && !SOURCE_BASED_CURRICULA_ENABLED) {
    return 'Source-based curricula are temporarily unavailable during the beta. Choose AI generated instead.'
  }
  return null
}
