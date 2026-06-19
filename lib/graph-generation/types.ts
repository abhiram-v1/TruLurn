import type { CurriculumMode } from '@/lib/ai/skills/types'

export const GRAPH_GENERATION_SCHEMA_VERSION = 'graph-generation-v2' as const
export const GRAPH_GENERATION_MODEL = 'gemini-3.1-pro-preview' as const

export type GraphSourceExcerpt = {
  heading_path: string[]
  text: string
}

export type GraphSourceEvidencePacket = {
  source_id: string
  source_number: number
  title: string
  headings: string[]
  topic_evidence: Array<{
    topic_id: string
    source_anchor: string
    excerpts: GraphSourceExcerpt[]
  }>
}

export type GraphGenerationInput = {
  curriculum: unknown
  mode: CurriculumMode
  sourceText?: string
  sourceEvidencePackets?: GraphSourceEvidencePacket[]
  generationRevision?: number
  signal?: AbortSignal
}

export type GraphGenerationIssue = {
  code: string
  message: string
  path?: string
}

export type GraphGenerationValidationReport = {
  valid: boolean
  issues: GraphGenerationIssue[]
  metrics: {
    curriculum_nodes: number
    graph_nodes: number
    branches: number
    edges: number
    source_backed_nodes: number
    orphan_nodes: number
    max_hard_fan_in: number
  }
}

export type GraphGenerationProvenance = {
  schema_version: typeof GRAPH_GENERATION_SCHEMA_VERSION
  provider: 'gemini'
  model: typeof GRAPH_GENERATION_MODEL
  generated_at: string
  generation_origin: 'generated'
  generation_revision: number
  curriculum_fingerprint: string
  source_fingerprint: string | null
  attempts: number
  validation_report: GraphGenerationValidationReport
}

export type GeneratedGraphMap = {
  branches: any[]
  topics: any[]
  structural_edges: any[]
  provenance?: GraphGenerationProvenance
  validation_report?: unknown
}

export type GraphGenerationResult = {
  map: GeneratedGraphMap
  sourceEvidencePackets: GraphSourceEvidencePacket[]
  provenance: GraphGenerationProvenance
}

export class GraphGenerationError extends Error {
  readonly code = 'GRAPH_GENERATION_FAILED'
  readonly attempts: number
  readonly validationReport: GraphGenerationValidationReport | null

  constructor(
    message: string,
    options: {
      attempts: number
      validationReport?: GraphGenerationValidationReport | null
      cause?: unknown
    },
  ) {
    super(message, options.cause ? { cause: options.cause } : undefined)
    this.name = 'GraphGenerationError'
    this.attempts = options.attempts
    this.validationReport = options.validationReport ?? null
  }
}
