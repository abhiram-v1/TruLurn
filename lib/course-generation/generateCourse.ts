import { generateAI, parseAIJson } from '@/lib/ai'
import { curriculumBuilderSkill, mapBuilderSkill } from '@/lib/ai/skills'
import { persistGeneratedCourse } from '@/lib/course-generation/mongoPersistence'
import { determineLessonStyle } from '@/lib/ai/skills/lessonStyle'
import { deriveLearnerPersona } from '@/lib/personalization/learnerPersona'
import { formatResearchBrief, researchCurriculum, type CourseResearchReport } from '@/lib/course-generation/research'
import { orderSourceGroundedInput } from '@/lib/course-generation/sourceOrdering'
import { analyzeSourceProfile } from '@/lib/course-generation/sourceProfile'
import { validateGraph, type ValidatorTopic, type ValidatorEdge } from '@/lib/course-generation/validateGraph'
import type { CourseGenerationInput } from '@/lib/course-generation/input'

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
function sanitizeGeneratedMap(map: any, curriculum: any) {
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

  map.validation_report = result.report
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
    const [orderedInput, sourceProfile] = await Promise.all([
      orderSourceGroundedInput(input),
      analyzeSourceProfile({ goals: input.goals, sourceText: input.sourceText }),
    ])
    input = { ...orderedInput, sourceProfile }
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
  const curriculum = parseAIJson<any>(curriculumText)

  // Run map build and style determination in parallel — both only need the curriculum.
  // A user-chosen teaching style skips the pedagogy classifier entirely.
  const branchTitles = Array.isArray(curriculum?.branches)
    ? curriculum.branches.map((b: any) => String(b?.title ?? '')).filter(Boolean)
    : []

  const userPickedStyle = input.teachingStyle && input.teachingStyle !== 'auto'
  const [mapText, styleResult, learnerPersona] = await Promise.all([
    generateAI({ feature: 'map_generation', ...mapBuilderSkill(curriculum) }),
    userPickedStyle
      ? Promise.resolve({ style: input.teachingStyle as any, reason: 'Chosen by the student at course setup.' })
      : determineLessonStyle(input.goals, curriculum?.title ?? input.topic, branchTitles),
    // Who is this learner? Derived from the goals + setup signals so lessons,
    // quizzes, and the agent never default to school-student framing.
    deriveLearnerPersona({
      goals: input.goals,
      knowledgeLevel: input.knowledgeLevel,
      learningPurpose: input.learningPurpose,
      sourceProfile: input.sourceProfile,
    }),
  ])

  const map = parseAIJson<any>(mapText)

  // Validate + repair the AI-generated graph topology before anything consumes it.
  sanitizeGeneratedMap(map, curriculum)

  const persisted = await persistGeneratedCourse({
    ...input,
    curriculum,
    map,
    learningStyle: styleResult.style,
    learningStyleReason: styleResult.reason,
    learnerPersona,
    researchReport,
  })

  return {
    ...persisted,
    sourceLimitations: input.sourceLimitations,
  }
}
