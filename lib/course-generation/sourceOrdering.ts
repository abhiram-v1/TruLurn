import { generateAIResult, parseAIJson, type AIProviderName } from '@/lib/ai'
import type { CourseGenerationInput } from '@/lib/course-generation/input'

type SourceBlock = {
  index: number
  title: string
  body: string
  raw: string
}

type SourceOrder = {
  ordered_source_numbers?: number[]
  confidence?: 'low' | 'medium' | 'high'
  strategy?: string
  evidence?: string[]
  warnings?: string[]
  provider?: AIProviderName
}

function parseSourceBlocks(sourceText: string): SourceBlock[] {
  return sourceText
    .split('\n\n---\n\n')
    .map((raw, index) => {
      const trimmed = raw.trim()
      const firstNewline = trimmed.indexOf('\n')
      const firstLine = firstNewline >= 0 ? trimmed.slice(0, firstNewline) : trimmed
      const body = firstNewline >= 0 ? trimmed.slice(firstNewline + 1).trim() : ''
      const numbered = firstLine.match(/^Source\s+(\d+):\s*(.+)$/i)
      const legacy = firstLine.match(/^Source:\s*(.+)$/i)
      return {
        index: numbered ? Number(numbered[1]) : index + 1,
        title: numbered?.[2]?.trim() || legacy?.[1]?.trim() || `Source ${index + 1}`,
        body: body || trimmed,
        raw: trimmed,
      }
    })
    .filter((block) => block.raw && block.body.trim())
}

function compactSource(block: SourceBlock) {
  const headings = block.body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false
      if (/^#{1,4}\s+/.test(line)) return true
      if (/^(chapter|unit|module|lecture|topic|section)\b/i.test(line)) return true
      if (/^\d+(\.\d+)*\s+/.test(line)) return true
      return false
    })
    .slice(0, 24)

  const excerpt = block.body
    .replace(/\s+/g, ' ')
    .slice(0, 2600)

  return [
    `Source ${block.index}: ${block.title}`,
    headings.length ? `Detected headings:\n- ${headings.join('\n- ')}` : 'Detected headings: none',
    `Opening excerpt:\n${excerpt}`,
  ].join('\n')
}

function validOrder(order: unknown, blocks: SourceBlock[]) {
  if (!Array.isArray(order)) return null
  const allowed = new Set(blocks.map((block) => block.index))
  const result: number[] = []
  for (const item of order) {
    const n = Number(item)
    if (allowed.has(n) && !result.includes(n)) result.push(n)
  }
  if (result.length !== blocks.length) return null
  return result
}

function orderBlocks(blocks: SourceBlock[], order: number[]) {
  const byIndex = new Map(blocks.map((block) => [block.index, block]))
  return order.map((index) => byIndex.get(index)).filter(Boolean) as SourceBlock[]
}

function formatAnalysis(report: SourceOrder, order: number[], blocks: SourceBlock[]) {
  const titleByIndex = new Map(blocks.map((block) => [block.index, block.title]))
  const sequence = order.map((index) => `Source ${index}: ${titleByIndex.get(index) ?? 'Untitled'}`).join(' -> ')
  const evidence = Array.isArray(report.evidence) ? report.evidence.filter(Boolean).slice(0, 6) : []
  const warnings = Array.isArray(report.warnings) ? report.warnings.filter(Boolean).slice(0, 4) : []

  return [
    `${report.provider ?? 'AI'} inferred source order: ${sequence}`,
    `Confidence: ${report.confidence ?? 'low'}`,
    report.strategy ? `Strategy: ${report.strategy}` : null,
    evidence.length ? `Evidence:\n- ${evidence.join('\n- ')}` : null,
    warnings.length ? `Warnings:\n- ${warnings.join('\n- ')}` : null,
  ].filter(Boolean).join('\n')
}

function orderingPrompt(input: CourseGenerationInput, blocks: SourceBlock[]) {
  return {
    system: `You are TruLurn's source ordering classifier.
You are cheap, fast, and precise. You do not generate a curriculum.
Your only job is to infer the best teaching/exam-prep order for uploaded source documents.`,
    user: `The learner goal is:
${input.goals}

Infer the best course order for these uploaded sources.

Signals to use, in priority order:
1. Explicit filenames or headings like Unit 1, Lecture 2, Chapter 3, Week 4.
2. Internal document structure and prerequisite language.
3. Concept prerequisite logic.
4. Upload order as a weak tie-breaker only.

For semester/exam-prep material, teacher/source sequence matters. If unsure, keep upload order and use confidence "low".

Sources:
---
${blocks.map(compactSource).join('\n\n---\n\n')}
---

Return only JSON:
{
  "ordered_source_numbers": [1, 2, 3],
  "confidence": "low|medium|high",
  "strategy": "short explanation of how order was inferred",
  "evidence": ["specific evidence"],
  "warnings": ["uncertainty or missing ordering signals"]
}`,
  }
}

async function classifyOrder(input: CourseGenerationInput, blocks: SourceBlock[]) {
  const prompt = orderingPrompt(input, blocks)
  const result = await generateAIResult({
    feature: 'source_ordering',
    ...prompt,
    responseMimeType: 'application/json',
    validateResponse: (text) => {
      try {
        return Boolean(validOrder(parseAIJson<SourceOrder>(text).ordered_source_numbers, blocks))
      } catch {
        return false
      }
    },
  })
  return { ...parseAIJson<SourceOrder>(result.text), provider: result.provider }
}

async function inferOrder(input: CourseGenerationInput, blocks: SourceBlock[]) {
  const errors: string[] = []

  try {
    const report = await classifyOrder(input, blocks)
    const order = validOrder(report.ordered_source_numbers, blocks)
    if (order) return { report, order, errors }
    errors.push(`${report.provider} returned an invalid or incomplete source order.`)
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Source ordering failed.')
  }

  return { report: null, order: null, errors }
}

export async function orderSourceGroundedInput<T extends CourseGenerationInput>(input: T): Promise<T> {
  if (input.mode !== 'source_grounded' || !input.sourceText?.trim()) return input

  const blocks = parseSourceBlocks(input.sourceText)
  if (blocks.length <= 1) return input

  const fallbackOrder = blocks.map((block) => block.index)

  const { report, order, errors } = await inferOrder(input, blocks)
  if (report && order) {
    const orderedBlocks = orderBlocks(blocks, order)
    return {
      ...input,
      sourceText: orderedBlocks.map((block) => block.raw).join('\n\n---\n\n'),
      sourceOrderAnalysis: formatAnalysis(report, order, blocks),
    }
  }

  return {
    ...input,
    sourceOrderAnalysis: [
      `Source ordering classifiers failed. Preserving upload order.`,
      ...errors.map((error) => `- ${error}`),
    ].join('\n'),
    sourceLimitations: [
      ...input.sourceLimitations,
      'Source ordering classifiers failed, so TruLurn preserved upload order.',
    ],
    sourceText: orderBlocks(blocks, fallbackOrder).map((block) => block.raw).join('\n\n---\n\n'),
  }
}
