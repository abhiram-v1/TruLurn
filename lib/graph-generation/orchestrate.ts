import { createHash } from 'crypto'
import { buildGraphSourceEvidencePackets } from './evidence.ts'
import { buildGraphGenerationPrompt, buildGraphRepairPrompt } from './prompt.ts'
import {
  GRAPH_GENERATION_MODEL,
  GRAPH_GENERATION_SCHEMA_VERSION,
  GraphGenerationError,
  type GeneratedGraphMap,
  type GraphGenerationInput,
  type GraphGenerationProvenance,
  type GraphGenerationResult,
  type GraphGenerationValidationReport,
} from './types.ts'
import { validateGeneratedCourseGraph } from './validate.ts'

const MAX_ATTEMPTS = 3

export type GraphGenerationRequest = {
  feature: 'graph_generation'
  system: string
  user: string
  responseMimeType: 'application/json'
  responseSchema: ReturnType<typeof buildGraphGenerationPrompt>['responseSchema']
  signal?: AbortSignal
}

export type GraphGenerationExecutor = (
  request: GraphGenerationRequest,
) => Promise<{ text: string; provider: string; model?: string }>

function fingerprint(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function parseGraphResponse(text: string) {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/)
  const source = fenced?.[1]?.trim() ?? trimmed
  const first = source.indexOf('{')
  const last = source.lastIndexOf('}')
  if (first < 0 || last <= first) {
    throw new Error('Gemini response did not contain a valid graph JSON object.')
  }
  return JSON.parse(source.slice(first, last + 1)) as GeneratedGraphMap
}

export async function runGraphGeneration(
  input: GraphGenerationInput,
  generate: GraphGenerationExecutor,
): Promise<GraphGenerationResult> {
  const sourceEvidencePackets = input.sourceEvidencePackets
    ?? (input.mode === 'source_grounded'
      ? buildGraphSourceEvidencePackets(input.curriculum, input.sourceText)
      : [])
  const normalizedInput = { ...input, sourceEvidencePackets }
  const originalPrompt = buildGraphGenerationPrompt(normalizedInput)
  let prompt = originalPrompt
  let previousOutput = ''
  let lastReport: GraphGenerationValidationReport | null = null
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await generate({
        feature: 'graph_generation',
        system: prompt.system,
        user: prompt.user,
        responseMimeType: 'application/json',
        responseSchema: prompt.responseSchema,
        signal: input.signal,
      })
      if (result.provider !== 'gemini' || result.model !== GRAPH_GENERATION_MODEL) {
        throw new Error(
          `Graph generation must run on gemini/${GRAPH_GENERATION_MODEL}; received ${result.provider}/${result.model ?? 'unknown'}.`,
        )
      }
      previousOutput = result.text
      const map = parseGraphResponse(result.text)
      const report = validateGeneratedCourseGraph(normalizedInput, map)
      lastReport = report

      if (report.valid) {
        const provenance: GraphGenerationProvenance = {
          schema_version: GRAPH_GENERATION_SCHEMA_VERSION,
          provider: 'gemini',
          model: GRAPH_GENERATION_MODEL,
          generated_at: new Date().toISOString(),
          generation_origin: 'generated',
          generation_revision: Math.max(1, Number(input.generationRevision ?? 1)),
          curriculum_fingerprint: fingerprint(input.curriculum),
          source_fingerprint: input.mode === 'source_grounded'
            ? fingerprint(sourceEvidencePackets)
            : null,
          attempts: attempt,
          validation_report: report,
        }
        map.provenance = provenance
        map.validation_report = report
        return { map, sourceEvidencePackets, provenance }
      }

      prompt = buildGraphRepairPrompt({
        original: originalPrompt,
        previousOutput,
        issues: report.issues,
      })
    } catch (error) {
      if (input.signal?.aborted) throw error
      lastError = error
      const parseReport: GraphGenerationValidationReport = {
        valid: false,
        issues: [{
          code: 'invalid_graph_response',
          message: error instanceof Error ? error.message : 'Gemini returned an unreadable graph response.',
        }],
        metrics: {
          curriculum_nodes: 0,
          graph_nodes: 0,
          branches: 0,
          edges: 0,
          source_backed_nodes: 0,
          orphan_nodes: 0,
          max_hard_fan_in: 0,
        },
      }
      lastReport = parseReport
      prompt = buildGraphRepairPrompt({
        original: originalPrompt,
        previousOutput,
        issues: parseReport.issues,
      })
    }
  }

  const detail = lastReport?.issues.slice(0, 4).map((issue) => issue.message).join(' ') ?? ''
  throw new GraphGenerationError(
    `Gemini could not produce a valid course graph after ${MAX_ATTEMPTS} attempts.${detail ? ` ${detail}` : ''}`,
    { attempts: MAX_ATTEMPTS, validationReport: lastReport, cause: lastError },
  )
}
