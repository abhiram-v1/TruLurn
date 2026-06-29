import { buildImmersiveBuilderDirective, IMMERSIVE_BUILDER } from './immersiveBuilder.ts'
import { buildInvestigatorDirective, INVESTIGATOR } from './investigator.ts'
import { buildPersonaVisualReasoningDirective } from './visualReasoning.ts'
import { buildPersonaAcademicContract } from './academicContract.ts'
import { buildMinimalLessonTeachingDirective } from './minimalLesson.ts'
import type {
  PersonaLessonContext,
  PersonaSurface,
  TeachingPersonaDefinition,
  TeachingPersonaId,
} from './types.ts'

export const DEFAULT_TEACHING_PERSONA: TeachingPersonaId = 'immersive_builder'

export const TEACHING_PERSONAS: Record<TeachingPersonaId, TeachingPersonaDefinition> = {
  immersive_builder: IMMERSIVE_BUILDER,
  investigator: INVESTIGATOR,
}

export function normalizeTeachingPersona(value: unknown): TeachingPersonaId {
  return value === 'immersive_builder' || value === 'investigator'
    ? value
    : DEFAULT_TEACHING_PERSONA
}

export function resolveTeachingPersonaFromMessage(message: string): TeachingPersonaId | null {
  const normalized = message.toLowerCase().replace(/[^a-z0-9\s_-]/g, ' ')
  if (/\b(investigator|investigative|mystery|evidence[- ]first|diagnostic)\b/.test(normalized)) {
    return 'investigator'
  }
  if (/\b(immersive builder|immersive|builder)\b/.test(normalized)) {
    return 'immersive_builder'
  }
  return null
}

export function resolveCourseTeachingPersona(course: any): TeachingPersonaId {
  return normalizeTeachingPersona(course?.teaching_persona)
}

export function buildPersonaDirective({
  persona,
  surface,
  lesson,
}: {
  persona?: unknown
  surface: PersonaSurface
  lesson?: PersonaLessonContext
}) {
  if (surface === 'lesson') return buildMinimalLessonTeachingDirective()

  let personaDirective: string
  switch (normalizeTeachingPersona(persona)) {
    case 'immersive_builder':
      personaDirective = buildImmersiveBuilderDirective({ surface, lesson })
      break
    case 'investigator':
      personaDirective = buildInvestigatorDirective({ surface, lesson })
      break
  }
  return `${personaDirective}

${buildPersonaAcademicContract(surface)}
${buildPersonaVisualReasoningDirective(surface)}`
}

export type {
  ImmersiveBuilderPageType,
  InvestigatorPageType,
  PersonaLessonContext,
  PersonaSurface,
  TeachingPersonaDefinition,
  TeachingPersonaId,
} from './types.ts'
export {
  buildMinimalLessonTeachingDirective,
  MINIMAL_LESSON_TEACHING_DIRECTIVE,
} from './minimalLesson.ts'
