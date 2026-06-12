import { NextResponse } from 'next/server'
import { generateAIResult, parseAIJson, resolveAIFeatureRoute } from '@/lib/ai'
import { curriculumBuilderSkill, mapBuilderSkill } from '@/lib/ai/skills'
import type {
  CourseDepth,
  KnowledgeLevel,
  LearningControlMode,
  LearningPurpose,
} from '@/lib/ai/skills/types'
import {
  formatResearchBrief,
  researchCurriculum,
  type CourseResearchReport,
} from '@/lib/course-generation/research'
import { buildSandboxGraphData, type SandboxMap } from '@/lib/graph/sandbox'
import { ensureSandboxEnvironment } from '@/lib/graph/sandboxEnvironment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type SandboxRequest = {
  prompt?: string
  learningControl?: LearningControlMode
  courseDepth?: CourseDepth
  knowledgeLevel?: KnowledgeLevel
  learningPurpose?: LearningPurpose
  includeResearch?: boolean
}

function isOneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? value as T : fallback
}

export async function GET() {
  try {
    ensureSandboxEnvironment()
    return NextResponse.json({
      ready: Boolean(
        process.env.OPENAI_API_KEY
        || process.env.GOOGLE_GENERATIVE_AI_API_KEY
        || process.env.GEMINI_API_KEY,
      ),
      provider: resolveAIFeatureRoute('curriculum_generation').provider,
      openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
      geminiConfigured: Boolean(
        process.env.GOOGLE_GENERATIVE_AI_API_KEY
        || process.env.GEMINI_API_KEY,
      ),
    })
  } catch (error) {
    return NextResponse.json({
      ready: false,
      error: error instanceof Error ? error.message : 'Environment check failed.',
    }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    ensureSandboxEnvironment()
    const body = await request.json() as SandboxRequest
    const prompt = String(body.prompt ?? '').trim()
    if (prompt.length < 10) {
      return NextResponse.json({ error: 'Enter a complete course-generation prompt.' }, { status: 400 })
    }

    const learningControl = isOneOf(
      body.learningControl,
      ['guided', 'balanced', 'open'] as const,
      'balanced',
    )
    const courseDepth = isOneOf(
      body.courseDepth,
      ['low', 'standard', 'high'] as const,
      'standard',
    )
    const knowledgeLevel = isOneOf(
      body.knowledgeLevel,
      ['beginner', 'intermediate', 'expert'] as const,
      'intermediate',
    )
    const learningPurpose = isOneOf(
      body.learningPurpose,
      ['explorer', 'practitioner', 'researcher'] as const,
      'practitioner',
    )
    const startedAt = Date.now()
    const stageTimes: Record<string, number> = {}
    let researchReport: CourseResearchReport | null = null

    if (body.includeResearch) {
      const researchStartedAt = Date.now()
      researchReport = await researchCurriculum({ goals: prompt, courseDepth, learningControl })
      stageTimes.research = Date.now() - researchStartedAt
    }

    const curriculumStartedAt = Date.now()
    const curriculumPrompt = curriculumBuilderSkill({
      topic: prompt,
      goals: prompt,
      mode: 'ai_teacher',
      learningControl,
      courseDepth,
      knowledgeLevel,
      learningPurpose,
      curriculumResearchBrief: formatResearchBrief(researchReport),
    })
    const curriculumGeneration = await generateAIResult({
      feature: 'curriculum_generation',
      ...curriculumPrompt,
    })
    const curriculum = parseAIJson<Record<string, unknown>>(curriculumGeneration.text)
    stageTimes.curriculum = Date.now() - curriculumStartedAt

    const mapStartedAt = Date.now()
    const mapGeneration = await generateAIResult({
      feature: 'map_generation',
      ...mapBuilderSkill(curriculum),
    })
    const map = parseAIJson<SandboxMap>(mapGeneration.text)
    stageTimes.map = Date.now() - mapStartedAt

    const graph = buildSandboxGraphData(curriculum, map)
    const generatedTopics = Array.isArray(map.topics) ? map.topics : []

    return NextResponse.json({
      curriculum,
      map,
      graph,
      researchReport,
      diagnostics: {
        provider: {
          curriculum: curriculumGeneration.provider,
          map: mapGeneration.provider,
        },
        totalMs: Date.now() - startedAt,
        stageTimes,
        topicCount: graph.course.topicCount,
        structuralNodeCount: generatedTopics.filter((topic) => topic.node_type === 'container').length,
        edgeCount: graph.edges.length,
        boxCount: graph.boxes.length,
        isolatedCount: graph.course.isolatedCount,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Graph generation failed.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
