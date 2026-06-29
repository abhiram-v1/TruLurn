import type { CurriculumSkillInput, SkillPrompt } from '@/lib/ai/skills/types'
import { curriculumResponseSchemaResolver } from '@/lib/ai/skills/curriculumSchema'
import {
  buildCurriculumFidelityNote,
  resolveSourceFidelityPolicy,
} from '@/lib/course-generation/sourceFidelity'
import { formatSourceProfileForCurriculum } from '@/lib/course-generation/sourceProfile'
import { formatCurriculumEvidence } from '@/lib/course-generation/sourceCompaction'
import {
  buildAITeacherCurriculumPrompt,
  buildLegacyAITeacherCurriculumPrompt,
  buildLegacySourceCurriculumPrompt,
  buildSourceCurriculumPrompt,
  type CurriculumPromptVersion,
  CURRICULUM_SYSTEM_PROMPT,
} from './curriculumPrompt'

export { CURRICULUM_PROMPT_VERSION } from './curriculumPrompt'

function sourcePrompt(
  input: CurriculumSkillInput,
  version: CurriculumPromptVersion,
) {
  const fidelity = buildCurriculumFidelityNote(resolveSourceFidelityPolicy({
    mode: input.mode,
    courseDepth: input.courseDepth,
    learningPurpose: input.learningPurpose,
    sourceProfile: input.sourceProfile,
  }))
  const profile = formatSourceProfileForCurriculum(input.sourceProfile)
  const evidence = input.compactCurriculumSource
    ? formatCurriculumEvidence(input.compactCurriculumSource)
    : input.sourceText ?? ''

  const context = {
    fidelityNote: fidelity,
    sourceProfile: profile,
    sourceEvidence: evidence,
  }
  return version === 'curriculum-legacy-v1'
    ? buildLegacySourceCurriculumPrompt(input, context)
    : buildSourceCurriculumPrompt(input, context)
}

export function curriculumBuilderSkill(
  input: CurriculumSkillInput,
  options: { version?: CurriculumPromptVersion } = {},
): SkillPrompt {
  const sourceMode = input.mode === 'source_grounded'
  const version = options.version ?? 'curriculum-v2'
  return {
    name: 'curriculum_builder',
    responseMimeType: 'application/json',
    responseSchema: curriculumResponseSchemaResolver(input.mode),
    system: CURRICULUM_SYSTEM_PROMPT,
    user: sourceMode
      ? sourcePrompt(input, version)
      : version === 'curriculum-legacy-v1'
        ? buildLegacyAITeacherCurriculumPrompt(input)
        : buildAITeacherCurriculumPrompt(input),
  }
}
