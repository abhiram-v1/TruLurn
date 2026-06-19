import { NextResponse } from 'next/server'
import { buildSandboxGraphData, type SandboxMap } from '@/lib/graph/sandbox'
import { ensureSandboxEnvironment } from '@/lib/graph/sandboxEnvironment'
import { generateCourseGraph } from '@/lib/graph-generation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
    const body = await request.json() as {
      curriculum?: Record<string, unknown>
      generationProfile?: 'fast' | 'production'
    }
    if (!body.curriculum || typeof body.curriculum !== 'object') {
      return NextResponse.json({ error: 'A generated curriculum is required.' }, { status: 400 })
    }

    const startedAt = Date.now()
    const generationProfile = body.generationProfile === 'production' ? 'production' : 'fast'
    const stageTimeout = generationProfile === 'fast' ? 75_000 : 180_000
    const generation = await withTimeout(
      (signal) => generateCourseGraph({
        curriculum: body.curriculum,
        mode: 'ai_teacher',
        signal,
      }),
      stageTimeout,
      'Graph topology generation',
    )
    const map = generation.map as SandboxMap
    const graph = buildSandboxGraphData(body.curriculum, map)
    const generatedTopics = Array.isArray(map.topics) ? map.topics : []

    return NextResponse.json({
      map,
      graph,
      mapMs: Date.now() - startedAt,
      diagnostics: {
        provider: generation.provenance.provider,
        topicCount: graph.course.topicCount,
        structuralNodeCount: generatedTopics.filter((topic) => topic.node_type === 'container').length,
        edgeCount: graph.edges.length,
        boxCount: graph.boxes.length,
        isolatedCount: graph.course.isolatedCount,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Graph topology generation failed.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
