import { generateAIResult } from '@/lib/ai'
import { runGraphGeneration } from './orchestrate.ts'
import type { GraphGenerationInput, GraphGenerationResult } from './types.ts'

export async function generateCourseGraph(
  input: GraphGenerationInput,
  dependencies: {
    generate?: typeof generateAIResult
  } = {},
): Promise<GraphGenerationResult> {
  const generate = dependencies.generate ?? generateAIResult
  return runGraphGeneration(input, generate)
}
