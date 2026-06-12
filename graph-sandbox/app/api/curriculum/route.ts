import { NextResponse } from 'next/server'
import { generateAIResult, parseAIJson } from '@/lib/ai'
import { curriculumBuilderSkill } from '@/lib/ai/skills'
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
import { ensureSandboxEnvironment } from '@/lib/graph/sandboxEnvironment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type CurriculumRequest = {
  prompt?: string
  learningControl?: LearningControlMode
  courseDepth?: CourseDepth
  knowledgeLevel?: KnowledgeLevel
  learningPurpose?: LearningPurpose
  includeResearch?: boolean
  generationProfile?: 'fast' | 'production'
}

function isOneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? value as T : fallback
}

async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ms)
  try {
    return await run(controller.signal)
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${label} timed out after ${Math.round(ms / 1000)} seconds.`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export async function POST(request: Request) {
  try {
    ensureSandboxEnvironment()
    const body = await request.json() as CurriculumRequest
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
    const generationProfile = isOneOf(
      body.generationProfile,
      ['fast', 'production'] as const,
      'fast',
    )
    const startedAt = Date.now()
    const stageTimes: Record<string, number> = {}
    let researchReport: CourseResearchReport | null = null

    if (body.includeResearch) {
      const researchStartedAt = Date.now()
      researchReport = await withTimeout(
        () => researchCurriculum({ goals: prompt, courseDepth, learningControl }),
        120_000,
        'Curriculum research',
      )
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
    const stageTimeout = generationProfile === 'fast' ? 75_000 : 180_000
    const generation = await withTimeout(
      (signal) => generateAIResult({
        feature: 'curriculum_generation',
        ...curriculumPrompt,
        purpose: generationProfile === 'production' ? 'primary' : 'agent',
        reasoningEffort: generationProfile === 'fast' ? 'low' : undefined,
        signal,
      }),
      stageTimeout,
      'Curriculum generation',
    )
    const curriculum = parseAIJson<Record<string, unknown>>(generation.text)
    stageTimes.curriculum = Date.now() - curriculumStartedAt

    return NextResponse.json({
      curriculum,
      researchReport,
      provider: generation.provider,
      generationProfile,
      stageTimes,
      totalMs: Date.now() - startedAt,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Curriculum generation failed.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
