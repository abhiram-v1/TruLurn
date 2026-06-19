import { generateAI, parseAIJson } from '@/lib/ai'
import { curriculumBuilderSkill } from '@/lib/ai/skills'
import { persistGeneratedCourse } from '@/lib/course-generation/mongoPersistence'
import { deriveLearnerAudience } from '@/lib/personalization/learnerAudience'
import { formatResearchBrief, researchCurriculum, type CourseResearchReport } from '@/lib/course-generation/research'
import { orderSourceGroundedInput } from '@/lib/course-generation/sourceOrdering'
import { analyzeSourceMetadata, triggerBackgroundStyleAnalysis, type SourceProfileEnvelope } from '@/lib/course-generation/sourceProfile'
import { getOrBuildSourceCompaction, buildSourceCompaction, formatCompactSourceForPrompt } from '@/lib/course-generation/sourceCompaction'
import { getDb } from '@/lib/db'
import { validateGraph, type ValidatorTopic, type ValidatorEdge } from '@/lib/course-generation/validateGraph'
import {
  enforceSourceGroundedCurriculum,
  enforceSourceGroundedMap,
} from '@/lib/course-generation/sourceCurriculumIntegrity'
import type { CourseGenerationInput } from '@/lib/course-generation/input'
import { generateCourseGraph } from '@/lib/graph-generation'

// Walk the curriculum tree and collect each topic's AI-emitted prerequisite_strength map.
function buildStrengthMap(curriculum: any): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>()
  const visit = (t: any) => {
    if (!t || typeof t !== 'object') return
    if (t.id && t.prerequisite_strength && typeof t.prerequisite_strength === 'object') {
      const rec: Record<string, string> = {}
      for (const [k, v] of Object.entries(t.prerequisite_strength)) {
        if (v === 'hard' || v === 'soft') rec[String(k)] = v
      }
      out.set(String(t.id), rec)
    }
    for (const c of t.children ?? []) visit(c)
  }
  for (const b of curriculum?.branches ?? []) {
    for (const s of b?.sections ?? []) {
      for (const t of s?.topics ?? []) visit(t)
    }
  }
  return out
}

// Validate + repair the candidate prerequisite graph in place on the map, so the
// AI's hallucinations never reach persistence or the renderer.
export function sanitizeGeneratedMap(map: any, curriculum: any) {
  if (!map || !Array.isArray(map.topics) || !map.topics.length) return
  const strengthMap = buildStrengthMap(curriculum)

  const vtopics: ValidatorTopic[] = map.topics.map((t: any) => ({
    id: String(t.id),
    parentId: t.parent_id ? String(t.parent_id) : null,
    branchId: String(t.branch_id ?? ''),
    sequenceIndex: Number.isFinite(t.sequence_index) ? Number(t.sequence_index) : Number(t.position ?? 0),
    prerequisites: Array.isArray(t.prerequisites) ? t.prerequisites.map(String) : [],
    prerequisiteStrength: strengthMap.get(String(t.id)) ?? (t.prerequisite_strength ?? {}),
  }))

  const vedges: ValidatorEdge[] = Array.isArray(map.structural_edges)
    ? map.structural_edges.map((e: any) => ({
        fromId: String(e.from_topic_id),
        toId: String(e.to_topic_id),
        type: String(e.edge_type ?? 'semantic'),
      }))
    : []

  const result = validateGraph(vtopics, vedges)

  // Apply cleaned prerequisites + strengths back onto the map topics.
  for (const t of map.topics) {
    const cleaned = result.topics.get(String(t.id))
    if (!cleaned) continue
    t.prerequisites = cleaned.prerequisites
    t.prerequisite_strength = cleaned.prerequisiteStrength
  }

  // Keep only structural edges that survived validation.
  if (Array.isArray(map.structural_edges)) {
    const keep = new Set(result.structuralEdges.map((e) => `${e.fromId}::${e.toId}::${e.type}`))
    map.structural_edges = map.structural_edges.filter(
      (e: any) => keep.has(`${String(e.from_topic_id)}::${String(e.to_topic_id)}::${String(e.edge_type ?? 'semantic')}`),
    )
  }

  map.topology_repair_report = result.report
  if (!map.provenance) map.validation_report = result.report
}

export type GeneratedCourseResult = {
  courseId: string
  firstTopicId: string
  sourceLimitations: string[]
}

export async function generateAndPersistCourse(input: CourseGenerationInput & { userId: string }): Promise<GeneratedCourseResult> {
  // Ordering rewrites sourceText sequence; profiling reads style + scope. They
  // are independent, so run them in parallel.
  if (input.mode === 'source_grounded' && input.sourceText) {
    const orderedInput = await orderSourceGroundedInput(input)
    
    let db: any = null
    try {
      db = await getDb()
    } catch {}

    let compactSource = null
    if (orderedInput.sourceVersionIds?.length && db) {
      compactSource = await getOrBuildSourceCompaction({
        db,
        sourceVersionIds: orderedInput.sourceVersionIds,
        userId: orderedInput.userId,
        sourceTextFallback: orderedInput.sourceText,
      })
    } else {
      compactSource = await buildSourceCompaction({
        sourceTextFallback: orderedInput.sourceText,
      })
    }

    const compactOutline = formatCompactSourceForPrompt(compactSource)

    const metadataProfile = await analyzeSourceMetadata({
      goals: orderedInput.goals,
      compactOutline,
      sourceFingerprint: compactSource.source_fingerprint,
    })

    const sourceProfile: SourceProfileEnvelope | null = metadataProfile
      ? {
          schema_version: 'source-profile-v2',
          source_fingerprint: compactSource.source_fingerprint,
          metadata: metadataProfile,
          style: null,
          style_status: 'pending',
          style_attempts: 0,
          metadata_generated_at: new Date().toISOString(),
          style_generated_at: null,
          style_error: null,
        }
      : null

    if (db && sourceProfile) {
      triggerBackgroundStyleAnalysis({
        db,
        userId: orderedInput.userId,
        generationJobId: 'sync-gen',
        sourceFingerprint: sourceProfile.source_fingerprint,
        goals: orderedInput.goals,
        sourceText: orderedInput.sourceText ?? '',
        metadata: sourceProfile.metadata,
      }).catch(console.error)
    }

    input = {
      ...orderedInput,
      sourceProfile,
      compactCurriculumSource: compactSource,
    }
  } else {
    input = await orderSourceGroundedInput(input)
  }
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
  const curriculumText = await generateAI({ feature: 'curriculum_generation', ...curriculumPrompt })
  let curriculum = parseAIJson<any>(curriculumText)
  if (input.mode === 'source_grounded') {
    curriculum = enforceSourceGroundedCurriculum(curriculum, {
      sourceText: input.sourceText,
      sourceProfile: input.sourceProfile,
    })
  }

  const [graphResult, learnerAudience] = await Promise.all([
    generateCourseGraph({
      curriculum,
      mode: input.mode,
      sourceText: input.sourceText,
    }),
    deriveLearnerAudience({
      goals: input.goals,
      knowledgeLevel: input.knowledgeLevel,
      learningPurpose: input.learningPurpose,
      sourceProfile: input.sourceProfile as any,
    }),
  ])

  const map = graphResult.map

  // Validate + repair the AI-generated graph topology before anything consumes it.
  sanitizeGeneratedMap(map, curriculum)
  if (input.mode === 'source_grounded') {
    enforceSourceGroundedMap(curriculum, map)
  }

  const persisted = await persistGeneratedCourse({
    ...input,
    curriculum,
    map,
    teachingPersona: input.teachingPersona,
    learnerAudience,
    researchReport,
  })

  return {
    ...persisted,
    sourceLimitations: input.sourceLimitations,
  }
}
