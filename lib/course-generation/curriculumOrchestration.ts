import { generateAIResult, parseAIJson } from '@/lib/ai'
import { curriculumBuilderSkill } from '@/lib/ai/skills'
import {
  curriculumResponseSchemaResolver,
  normalizeOpenAIPrerequisiteStrength,
} from '@/lib/ai/skills/curriculumSchema'
import type { CurriculumPromptVersion } from '@/lib/ai/skills/curriculumPrompt'
import { assertResolvableModel } from '@/lib/ai/routing'
import type { CourseGenerationInput } from '@/lib/course-generation/input'
import {
  formatResearchBrief,
  type CourseResearchReport,
} from '@/lib/course-generation/research'
import { getDb } from '@/lib/db'
import { formatSourceProfileForCurriculum } from './sourceProfile'
import {
  CURRICULUM_REPAIR_PROMPT_VERSION,
  buildSourceCurriculumRepairPrompt,
  shouldAttemptSourceCurriculumModelRepair,
} from './curriculumRepair'
import {
  recordCurriculumRepairTelemetry,
  recordCurriculumResultTelemetry,
  recordCurriculumShadowTelemetry,
} from './curriculumRepairTelemetry'
import {
  finalizeCurriculum,
  hydrateCurriculumDefaults,
} from './curriculumHydration'
import {
  SourceCurriculumIntegrityError,
  classifySourceCurriculumIssues,
  enforceSourceGroundedCurriculum,
  hydrateSourceGroundedCurriculum,
  normalizeSourceGroundedCurriculumBoundary,
  repairMechanicalSourceGroundedCurriculum,
  validateSourceGroundedCurriculum,
} from './sourceCurriculumIntegrity'
import {
  compareCurriculumCandidates,
  curriculumQualityScore,
  getCurriculumRolloutHealth,
  normalizeCurriculumRolloutMode,
  resolveCurriculumRolloutSelection,
} from './curriculumRollout'

export { finalizeCurriculum, hydrateCurriculumDefaults } from './curriculumHydration'

function sourceValidationOptions(input: CourseGenerationInput) {
  return {
    sourceText: input.sourceText,
    sourceProfile: input.sourceProfile,
    compactCurriculumSource: input.compactCurriculumSource,
  }
}

function prepareSourceCandidate(curriculum: any, input: CourseGenerationInput) {
  hydrateCurriculumDefaults(curriculum, input)
  const options = sourceValidationOptions(input)
  normalizeSourceGroundedCurriculumBoundary(curriculum, input.sourceProfile)
  hydrateSourceGroundedCurriculum(curriculum, options)

  let report = validateSourceGroundedCurriculum(curriculum, options)
  const classification = classifySourceCurriculumIssues(report.issues)
  if (classification.irrecoverable.length) {
    throw new SourceCurriculumIntegrityError(classification.irrecoverable)
  }

  if (classification.mechanical.length) {
    repairMechanicalSourceGroundedCurriculum(curriculum, report.issues, options)
    hydrateSourceGroundedCurriculum(curriculum, options)
    report = validateSourceGroundedCurriculum(curriculum, options)
  }
  return { curriculum, report }
}

async function conditionallyRepairSourceCurriculum(input: {
  curriculum: any
  courseInput: CourseGenerationInput
  promptVersion: CurriculumPromptVersion
  initialProvider?: string
  initialModel?: string
}) {
  const prepared = prepareSourceCandidate(input.curriculum, input.courseInput)
  const initialIssueCodes = prepared.report.issues.map((issue) => issue.code)

  if (!shouldAttemptSourceCurriculumModelRepair(prepared.report)) {
    const final = enforceSourceGroundedCurriculum(
      prepared.curriculum,
      sourceValidationOptions(input.courseInput),
    )
    final.source_model_repair_report = {
      attempted: false,
      outcome: 'not_needed',
      prompt_version: CURRICULUM_REPAIR_PROMPT_VERSION,
      provider: null,
      model: null,
      initial_issue_codes: [...new Set(initialIssueCodes)],
      remaining_issue_codes: final.source_validation_report?.issues?.map((issue: any) => issue.code) ?? [],
      duration_ms: 0,
      error: null,
    }
    recordCurriculumRepairTelemetry({
      mode: input.courseInput.mode,
      userId: (input.courseInput as any).userId,
      promptVersion: input.promptVersion,
      repairPromptVersion: CURRICULUM_REPAIR_PROMPT_VERSION,
      initialProvider: input.initialProvider,
      initialModel: input.initialModel,
      attempted: false,
      outcome: 'not_needed',
      initialIssueCodes,
      remainingIssueCodes: final.source_validation_report?.issues?.map((issue: any) => issue.code) ?? [],
    })
    return final
  }

  const repairPrompt = buildSourceCurriculumRepairPrompt({
    candidate: prepared.curriculum,
    report: prepared.report,
    compactSource: input.courseInput.compactCurriculumSource,
    sourceProfile: formatSourceProfileForCurriculum(input.courseInput.sourceProfile),
    sourceOrderAnalysis: input.courseInput.sourceOrderAnalysis,
  })

  const startedAt = performance.now()
  let repairProvider: string | undefined
  let repairModel: string | undefined
  let repairFailure: unknown
  let repairedCandidate: any = prepared.curriculum

  try {
    const result = await generateAIResult({
      feature: 'curriculum_generation',
      ...repairPrompt,
      responseMimeType: 'application/json',
      responseSchema: curriculumResponseSchemaResolver('source_grounded'),
    })
    repairProvider = result.provider
    repairModel = result.model
    repairedCandidate = parseAIJson<any>(result.text)
    if (result.provider === 'openai') {
      normalizeOpenAIPrerequisiteStrength(repairedCandidate)
    }
    repairedCandidate = prepareSourceCandidate(
      repairedCandidate,
      input.courseInput,
    ).curriculum
  } catch (error) {
    repairFailure = error
  }

  let final: any
  try {
    final = enforceSourceGroundedCurriculum(
      repairedCandidate,
      sourceValidationOptions(input.courseInput),
    )
  } catch (error) {
    const failureIssues = error instanceof SourceCurriculumIntegrityError
      ? error.issues
      : []
    recordCurriculumRepairTelemetry({
      mode: input.courseInput.mode,
      userId: (input.courseInput as any).userId,
      promptVersion: input.promptVersion,
      repairPromptVersion: CURRICULUM_REPAIR_PROMPT_VERSION,
      initialProvider: input.initialProvider,
      initialModel: input.initialModel,
      repairProvider,
      repairModel,
      attempted: true,
      outcome: 'repair_failed',
      durationMs: performance.now() - startedAt,
      initialIssueCodes,
      remainingIssueCodes: failureIssues.map((issue) => issue.code),
    })
    throw error
  }

  const remainingIssues = final.source_validation_report?.issues ?? []
  const remainingSubstantive = classifySourceCurriculumIssues(remainingIssues).substantive
  const outcome = repairFailure
    ? 'repair_failed'
    : remainingSubstantive.length
      ? 'fallback_cleanup'
      : remainingIssues.length
        ? 'partially_repaired'
        : 'repaired'

  final.source_model_repair_report = {
    attempted: true,
    outcome,
    prompt_version: CURRICULUM_REPAIR_PROMPT_VERSION,
    provider: repairProvider ?? null,
    model: repairModel ?? null,
    initial_issue_codes: [...new Set(initialIssueCodes)],
    remaining_issue_codes: [...new Set(remainingIssues.map((issue: any) => issue.code))],
    duration_ms: Math.round(performance.now() - startedAt),
    error: repairFailure instanceof Error ? repairFailure.message : null,
  }

  recordCurriculumRepairTelemetry({
    mode: input.courseInput.mode,
    userId: (input.courseInput as any).userId,
    promptVersion: input.promptVersion,
    repairPromptVersion: CURRICULUM_REPAIR_PROMPT_VERSION,
    initialProvider: input.initialProvider,
    initialModel: input.initialModel,
    repairProvider,
    repairModel,
    attempted: true,
    outcome,
    durationMs: performance.now() - startedAt,
    initialIssueCodes,
    remainingIssueCodes: remainingIssues.map((issue: any) => issue.code),
  })
  return final
}

async function generateCurriculumVersion(input: {
  courseInput: CourseGenerationInput
  researchReport: CourseResearchReport | null
  version: CurriculumPromptVersion
}) {
  const prompt = curriculumBuilderSkill({
    ...input.courseInput,
    curriculumResearchBrief: formatResearchBrief(input.researchReport),
  }, {
    version: input.version,
  })
  const result = await generateAIResult({
    feature: 'curriculum_generation',
    ...prompt,
  })
  const curriculum = parseAIJson<any>(result.text)
  if (result.provider === 'openai') {
    normalizeOpenAIPrerequisiteStrength(curriculum)
  }
  const finalized = input.courseInput.mode === 'source_grounded'
    ? await conditionallyRepairSourceCurriculum({
        curriculum,
        courseInput: input.courseInput,
        promptVersion: input.version,
        initialProvider: result.provider,
        initialModel: result.model,
      })
    : finalizeCurriculum(curriculum, input.courseInput)
  return {
    curriculum: finalized,
    provider: result.provider,
    model: result.model,
    usage: result.usage,
  }
}

export async function generateCurriculum(
  input: CourseGenerationInput,
  researchReport: CourseResearchReport | null,
) {
  assertResolvableModel('curriculum_generation')
  let db: Awaited<ReturnType<typeof getDb>> | null = null
  try {
    db = await getDb()
  } catch {}

  const health = await getCurriculumRolloutHealth(db)
  const rolloutMode = normalizeCurriculumRolloutMode(
    process.env.CURRICULUM_ROLLOUT_MODE,
  )
  const userId = String((input as any).userId ?? 'anonymous')
  const requestKey = input.compactCurriculumSource?.source_fingerprint
    ?? input.goals
  const selection = resolveCurriculumRolloutSelection({
    mode: rolloutMode,
    rolloutPercent: Number(process.env.CURRICULUM_ROLLOUT_PERCENT ?? 0),
    seed: process.env.CURRICULUM_ROLLOUT_SEED ?? 'trulurn-curriculum-v2',
    userId,
    requestKey,
    health,
    shadowExecutionEnabled: process.env.CURRICULUM_SHADOW_EXECUTE === '1',
  })

  const startedAt = performance.now()
  try {
    const primary = await generateCurriculumVersion({
      courseInput: input,
      researchReport,
      version: selection.selectedVersion,
    })
    const quality = curriculumQualityScore(primary.curriculum, input.mode)
    const healthForcedRollback =
      !selection.health.healthy
      && selection.selectedVersion === 'curriculum-legacy-v1'

    recordCurriculumResultTelemetry({
      mode: input.mode,
      userId,
      promptVersion: selection.selectedVersion,
      rolloutMode: selection.mode,
      cohortBucket: selection.cohortBucket,
      provider: primary.provider,
      model: primary.model,
      status: 'succeeded',
      durationMs: performance.now() - startedAt,
      qualityScore: quality,
      repairAttempted: Boolean(primary.curriculum?.source_model_repair_report?.attempted),
      repairOutcome: primary.curriculum?.source_model_repair_report?.outcome,
      healthForcedRollback,
      usage: primary.usage,
    })

    if (selection.collectShadow && selection.shadowVersion) {
      const shadowStartedAt = performance.now()
      try {
        const shadow = await generateCurriculumVersion({
          courseInput: input,
          researchReport,
          version: selection.shadowVersion,
        })
        recordCurriculumShadowTelemetry({
          userId,
          mode: input.mode,
          primaryVersion: selection.selectedVersion,
          shadowVersion: selection.shadowVersion,
          primaryQuality: quality,
          shadowQuality: curriculumQualityScore(shadow.curriculum, input.mode),
          comparison: compareCurriculumCandidates(
            primary.curriculum,
            shadow.curriculum,
          ),
          shadowProvider: shadow.provider,
          shadowModel: shadow.model,
          shadowUsage: shadow.usage,
          durationMs: performance.now() - shadowStartedAt,
          status: 'succeeded',
        })
      } catch (error) {
        recordCurriculumShadowTelemetry({
          userId,
          mode: input.mode,
          primaryVersion: selection.selectedVersion,
          shadowVersion: selection.shadowVersion,
          primaryQuality: quality,
          shadowQuality: 0,
          comparison: {},
          durationMs: performance.now() - shadowStartedAt,
          status: 'failed',
          error,
        })
      }
    }

    primary.curriculum.curriculum_rollout = {
      mode: selection.mode,
      prompt_version: selection.selectedVersion,
      cohort_bucket: selection.cohortBucket,
      canary_selected: selection.canarySelected,
      shadow_collected: selection.collectShadow,
      health_forced_rollback: healthForcedRollback,
    }
    return primary.curriculum
  } catch (error) {
    recordCurriculumResultTelemetry({
      mode: input.mode,
      userId,
      promptVersion: selection.selectedVersion,
      rolloutMode: selection.mode,
      cohortBucket: selection.cohortBucket,
      status: 'failed',
      durationMs: performance.now() - startedAt,
      qualityScore: 0,
      repairAttempted: false,
      healthForcedRollback:
        !selection.health.healthy
        && selection.selectedVersion === 'curriculum-legacy-v1',
      error,
    })
    throw error
  }
}
