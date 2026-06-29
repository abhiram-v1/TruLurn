import crypto from 'crypto'
import type { Db } from 'mongodb'

export type CompactSourceSection = {
  source_id: string
  // Stable short reference (e.g. "s1:3" = source 1, section 3) used for
  // traceable curriculum citations in place of fragile free-text anchors.
  id: string
  heading_path: string[]
  ordinal: number
  opening_excerpt: string
  key_definitions: string[]
  enumerations: string[]
  learning_objectives: string[]
  code_samples: string[]
  table_summaries: string[]
  original_char_count: number
}

export type CompactCurriculumSource = {
  schema_version: 'curriculum-source-v1'
  source_fingerprint: string
  compaction_version: string
  original_char_count: number
  compact_char_count: number
  sources: Array<{
    source_id: string
    title: string
    headings: string[]
    sections: CompactSourceSection[]
  }>
  coverage_report: {
    source_count: number
    represented_source_count: number
    heading_count: number
    represented_heading_count: number
    omitted_sections: string[]
    valid: boolean
    budget_chars: number
    within_budget: boolean
    trimmed_section_count: number
  }
}

type CanonicalBlockType = 'heading' | 'paragraph' | 'list' | 'table' | 'code'

type CanonicalBlock = {
  ordinal: number
  type: CanonicalBlockType
  content: string
  headingPath: string[]
  charStart: number
  charEnd: number
}

// Internal block parser in case we are running on raw text
function blockType(content: string): CanonicalBlockType {
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean)
  if (lines.length && lines.every((line) => /^([-*+]|\d+\.)\s+/.test(line))) return 'list'
  if (lines.length >= 2 && lines.every((line) => line.includes('|'))) return 'table'
  return 'paragraph'
}

function parseBlocksFromText(text: string): CanonicalBlock[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim()
  const lines = normalized.split('\n')
  const blocks: CanonicalBlock[] = []
  const headingPath: string[] = []
  let buffer: string[] = []
  let codeBuffer: string[] = []
  let inCode = false
  let cursor = 0

  function push(content: string, type: CanonicalBlockType) {
    const clean = content.trim()
    if (!clean) return
    const found = normalized.indexOf(clean, cursor)
    const charStart = found >= 0 ? found : cursor
    const charEnd = charStart + clean.length
    cursor = charEnd
    blocks.push({
      ordinal: blocks.length,
      type,
      content: clean,
      headingPath: [...headingPath],
      charStart,
      charEnd,
    })
  }

  function flushBuffer() {
    if (!buffer.length) return
    const content = buffer.join('\n')
    buffer = []
    push(content, blockType(content))
  }

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      flushBuffer()
      codeBuffer.push(line)
      if (inCode) {
        push(codeBuffer.join('\n'), 'code')
        codeBuffer = []
      }
      inCode = !inCode
      continue
    }
    if (inCode) {
      codeBuffer.push(line)
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (heading) {
      flushBuffer()
      const level = heading[1].length
      const title = heading[2].trim()
      headingPath.splice(level - 1)
      headingPath[level - 1] = title
      push(line, 'heading')
      continue
    }

    if (!line.trim()) {
      flushBuffer()
      continue
    }
    buffer.push(line)
  }

  flushBuffer()
  if (codeBuffer.length) push(codeBuffer.join('\n'), 'code')
  return blocks
}

// Generate a deterministic SHA-256 fingerprint for input versions or text
export function generateSourceFingerprint(sourceVersionIds: string[] | string): string {
  const input = Array.isArray(sourceVersionIds) ? [...sourceVersionIds].sort().join(',') : sourceVersionIds
  return crypto.createHash('sha256').update(input).digest('hex')
}

// Formats a CompactCurriculumSource to a readable text representation for prompts
export function formatCompactSourceForPrompt(compact: CompactCurriculumSource): string {
  const result: string[] = []

  for (const src of compact.sources) {
    result.push(`=== Source: ${src.title} ===`)
    for (const section of src.sections) {
      const path = section.heading_path.join(' > ') || 'Root Section'
      result.push(`\n## Section [${section.id}]: ${path}`)

      if (section.opening_excerpt) {
        result.push(`Excerpt: ${section.opening_excerpt}`)
      }
      if (section.key_definitions.length) {
        result.push(`Definitions:\n- ${section.key_definitions.join('\n- ')}`)
      }
      if (section.learning_objectives.length) {
        result.push(`Objectives:\n- ${section.learning_objectives.join('\n- ')}`)
      }
      if (section.enumerations.length) {
        result.push(`Key Lists:\n- ${section.enumerations.join('\n- ')}`)
      }
      if (section.code_samples.length) {
        result.push(`Code Samples:\n${section.code_samples.join('\n\n')}`)
      }
      if (section.table_summaries.length) {
        result.push(`Table Excerpts:\n${section.table_summaries.join('\n\n')}`)
      }
    }
    result.push('\n')
  }

  return result.join('\n')
}

// Curriculum-evidence projection: the fuller, budget-bounded source evidence
// used for curriculum generation. Carries stable section IDs for citation.
export const formatCurriculumEvidence = formatCompactSourceForPrompt

export type CompactSectionLookup = {
  section: CompactSourceSection
  sourceNumber: number
  sourceTitle: string
}

// Index every section by its stable id (e.g. "s1:3") for O(1) citation
// validation — replaces fuzzy text matching against raw source content.
export function indexCompactSections(
  compact: CompactCurriculumSource | null | undefined,
): Map<string, CompactSectionLookup> {
  const index = new Map<string, CompactSectionLookup>()
  if (!compact) return index
  compact.sources.forEach((source, sourceIndex) => {
    for (const section of source.sections) {
      index.set(section.id, { section, sourceNumber: sourceIndex + 1, sourceTitle: source.title })
    }
  })
  return index
}

// Derives a human-readable anchor ("Source 2 — Locking Protocols") from the
// first ref that resolves to a real section. Returns '' when no ref is valid
// — callers must not fabricate a fallback anchor for unsupported evidence.
export function deriveSourceAnchor(
  compact: CompactCurriculumSource | null | undefined,
  refs: unknown,
  index: Map<string, CompactSectionLookup> = indexCompactSections(compact),
): string {
  if (!Array.isArray(refs)) return ''
  for (const ref of refs) {
    const hit = index.get(String(ref))
    if (hit) {
      const path = hit.section.heading_path.join(' > ') || hit.sourceTitle
      return `Source ${hit.sourceNumber} — ${path}`
    }
  }
  return ''
}

// Profile-outline projection: a slim headings-and-signal view used by the
// source-profiling stage, capped well below the curriculum-evidence budget.
// Keeps section IDs + heading paths + one high-signal line per section.
export function formatProfileOutline(
  compact: CompactCurriculumSource,
  maxChars = 8000,
): string {
  const lines: string[] = []

  for (const src of compact.sources) {
    lines.push(`=== Source: ${src.title} ===`)
    for (const section of src.sections) {
      const path = section.heading_path.join(' > ') || 'Root Section'
      const signal =
        section.key_definitions[0]
        || section.learning_objectives[0]
        || section.opening_excerpt
      const signalText = signal
        ? ` — ${signal.replace(/\s+/g, ' ').trim().slice(0, 140)}`
        : ''
      lines.push(`[${section.id}] ${path}${signalText}`)
    }
  }

  const out = lines.join('\n')
  if (out.length <= maxChars) return out
  return out.slice(0, maxChars - 1).trimEnd() + '…'
}

// Detect definitions, objectives, etc.
function extractDefinitions(content: string): string[] {
  const defRegex = /\b(is defined as|refers to|means|is a type of|describes)\b/i
  return content.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 15 && defRegex.test(line))
}

function extractObjectives(content: string): string[] {
  const objRegex = /\b(objective|goal|learn|understand|aim to|will cover|focuses on)\b/i
  return content.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 15 && objRegex.test(line))
}

// Serialized size of a section's evidence, matching the prompt projection.
// Kept in sync with how compact_char_count is computed.
function sectionCompactSize(sec: CompactSourceSection): number {
  return sec.opening_excerpt.length
    + sec.key_definitions.join('').length
    + sec.enumerations.join('').length
    + sec.learning_objectives.join('').length
    + sec.code_samples.join('').length
    + sec.table_summaries.join('').length
}

// Reduce a section to at most `budget` chars, keeping the highest-value
// evidence (a definition-aware excerpt, then definitions) and shedding
// lower-value arrays first. The excerpt is the elastic field that absorbs
// the remaining budget. Returns true if anything was trimmed.
function clampSectionToBudget(sec: CompactSourceSection, budget: number): boolean {
  if (sectionCompactSize(sec) <= budget) return false

  const keepWhileFits = (items: string[], remaining: number): { kept: string[]; used: number } => {
    const kept: string[] = []
    let used = 0
    for (const item of items) {
      if (used + item.length > remaining) continue
      kept.push(item)
      used += item.length
    }
    return { kept, used }
  }

  let remaining = Math.max(0, budget)

  // Reserve room for definitions so a long excerpt cannot crowd them out.
  const defsSize = sec.key_definitions.join('').length
  const reserve = Math.min(defsSize, Math.floor(remaining / 2))
  const excerptBudget = Math.max(0, remaining - reserve)
  if (sec.opening_excerpt.length > excerptBudget) {
    sec.opening_excerpt = excerptBudget > 1
      ? sec.opening_excerpt.slice(0, excerptBudget - 1).trimEnd() + '…'
      : ''
  }
  remaining -= sec.opening_excerpt.length

  // Shed remaining evidence in ascending order of curriculum value.
  for (const field of [
    'key_definitions',
    'learning_objectives',
    'enumerations',
    'code_samples',
    'table_summaries',
  ] as const) {
    const result = keepWhileFits(sec[field], remaining)
    sec[field] = result.kept
    remaining -= result.used
  }

  return true
}

// Globally enforce the compaction budget with max-min fair allocation:
// process sections from smallest to largest so small sections keep their
// content while large sections share the remaining budget equally. This
// prevents a few large sections from consuming the entire budget and
// guarantees the total stays at or under targetChars.
function enforceCompactionBudget(
  sources: CompactCurriculumSource['sources'],
  targetChars: number,
): { totalChars: number; trimmedSectionCount: number } {
  const allSections = sources.flatMap((s) => s.sections)
  let totalChars = allSections.reduce((acc, s) => acc + sectionCompactSize(s), 0)
  if (totalChars <= targetChars) {
    return { totalChars, trimmedSectionCount: 0 }
  }

  const ordered = [...allSections].sort(
    (a, b) => sectionCompactSize(a) - sectionCompactSize(b),
  )
  let remainingBudget = targetChars
  let remainingCount = ordered.length
  let trimmedSectionCount = 0

  for (const sec of ordered) {
    const fairShare = Math.floor(remainingBudget / Math.max(1, remainingCount))
    const size = sectionCompactSize(sec)
    if (size <= fairShare) {
      remainingBudget -= size
    } else {
      clampSectionToBudget(sec, fairShare)
      remainingBudget -= sectionCompactSize(sec)
      trimmedSectionCount += 1
    }
    remainingCount -= 1
  }

  totalChars = allSections.reduce((acc, s) => acc + sectionCompactSize(s), 0)
  return { totalChars, trimmedSectionCount }
}

/**
 * Builds a structured, size-adapted compaction of the curriculum sources.
 */
export async function buildSourceCompaction({
  db,
  sourceVersionIds,
  sourceTextFallback,
  sourceTitles,
}: {
  db?: Db
  sourceVersionIds?: string[]
  sourceTextFallback?: string
  sourceTitles?: string[]
}): Promise<CompactCurriculumSource> {
  const COMPACTION_VERSION = 'v1.1'
  let fingerprint = ''
  let originalCharCount = 0

  type SourceData = {
    id: string
    title: string
    blocks: CanonicalBlock[]
  }
  const sourcesData: SourceData[] = []

  if (db && sourceVersionIds && sourceVersionIds.length > 0) {
    fingerprint = generateSourceFingerprint(sourceVersionIds)
    // Fetch from DB
    const versions = await db.collection('sourceDocumentVersions')
      .find({ _id: { $in: sourceVersionIds as any[] } })
      .toArray()
    const versionMap = new Map(versions.map(v => [String(v._id), v]))

    for (let i = 0; i < sourceVersionIds.length; i++) {
      const vId = sourceVersionIds[i]
      const versionDoc = versionMap.get(vId)
      const title = versionDoc?.filename || `Source ${i + 1}`
      const blocksFromDb = await db.collection('sourceBlocks')
        .find({ source_version_id: vId })
        .sort({ ordinal: 1 })
        .toArray()

      const parsedBlocks: CanonicalBlock[] = blocksFromDb.map(b => ({
        ordinal: b.ordinal,
        type: b.block_type as CanonicalBlockType,
        content: b.content,
        headingPath: b.heading_path || [],
        charStart: b.char_start,
        charEnd: b.char_end,
      }))

      originalCharCount += parsedBlocks.reduce((acc, b) => acc + b.content.length, 0)
      sourcesData.push({ id: vId, title, blocks: parsedBlocks })
    }
  } else {
    // Text fallback
    const rawText = sourceTextFallback || ''
    originalCharCount = rawText.length
    fingerprint = generateSourceFingerprint(rawText)

    // Parse blocks from text
    const parts = rawText.split('\n\n---\n\n')
    parts.forEach((part, index) => {
      const title = sourceTitles?.[index] || `Source ${index + 1}`
      const blocks = parseBlocksFromText(part)
      sourcesData.push({ id: `temp-id-${index}`, title, blocks })
    })
  }

  // Determine budget policy
  // Under 25K: no aggressive compaction, keep everything.
  // 25K to 120K: compact to around 20K chars.
  // Over 120K: compact to around 30K chars.
  let targetChars = 0
  let mode: 'full' | 'compact' | 'hierarchical' = 'full'
  if (originalCharCount > 120000) {
    targetChars = 30000
    mode = 'hierarchical'
  } else if (originalCharCount > 25000) {
    targetChars = 20000
    mode = 'compact'
  }

  const compactedSources: CompactCurriculumSource['sources'] = []
  let totalCompactChars = 0

  const representedSourceIds = new Set<string>()
  const headingSet = new Set<string>()
  const representedHeadingSet = new Set<string>()
  const omittedSections: string[] = []

  for (const src of sourcesData) {
    // Group blocks by section (unique heading path)
    const sectionMap = new Map<string, CanonicalBlock[]>()
    const headingPaths: string[][] = []

    src.blocks.forEach(block => {
      const pathKey = block.headingPath.join(' > ')
      if (!sectionMap.has(pathKey)) {
        sectionMap.set(pathKey, [])
        headingPaths.push(block.headingPath)
      }
      sectionMap.get(pathKey)!.push(block)
    })

    const sections: CompactSourceSection[] = []
    let secOrdinal = 0

    // Add unique headings to general list
    headingPaths.forEach(path => {
      if (path.length) headingSet.add(path.join(' > '))
    })

    for (const path of headingPaths) {
      const pathKey = path.join(' > ')
      const blocks = sectionMap.get(pathKey) || []
      const sectionCharCount = blocks.reduce((acc, b) => acc + b.content.length, 0)

      let openingExcerpt = ''
      const keyDefinitions: string[] = []
      const enumerations: string[] = []
      const learningObjectives: string[] = []
      const codeSamples: string[] = []
      const tableSummaries: string[] = []

      // Excerpt extraction: get the first few paragraph contents
      const paragraphs = blocks.filter(b => b.type === 'paragraph')
      const paragraphsText = paragraphs.map(p => p.content).join('\n')
      
      // Definitions, objectives
      blocks.forEach(b => {
        if (b.type === 'paragraph') {
          keyDefinitions.push(...extractDefinitions(b.content))
          learningObjectives.push(...extractObjectives(b.content))
        } else if (b.type === 'list') {
          enumerations.push(b.content)
        } else if (b.type === 'code') {
          codeSamples.push(b.content)
        } else if (b.type === 'table') {
          tableSummaries.push(b.content)
        }
      })

      if (mode === 'full') {
        openingExcerpt = paragraphsText
      } else {
        // Truncate based on mode
        const excerptLen = mode === 'compact' ? 500 : 300
        openingExcerpt = paragraphsText.slice(0, excerptLen)
        if (paragraphsText.length > excerptLen) openingExcerpt += '...'
      }

      // Compact arrays depending on mode budget
      const sliceLimit = mode === 'full' ? 99 : (mode === 'compact' ? 3 : 2)
      
      const secRecord: CompactSourceSection = {
        source_id: src.id,
        // 1-based source/section reference; sources are pushed in order, so the
        // current source's number is the count already finalized plus one.
        id: `s${compactedSources.length + 1}:${secOrdinal + 1}`,
        heading_path: path,
        ordinal: secOrdinal++,
        opening_excerpt: openingExcerpt,
        key_definitions: keyDefinitions.slice(0, sliceLimit),
        enumerations: enumerations.slice(0, sliceLimit),
        learning_objectives: learningObjectives.slice(0, sliceLimit),
        code_samples: codeSamples.slice(0, Math.min(sliceLimit, 2)),
        table_summaries: tableSummaries.slice(0, Math.min(sliceLimit, 2)),
        original_char_count: sectionCharCount,
      }

      // Check if this section was completely omitted or has substance
      const hasSubstance = secRecord.opening_excerpt || 
        secRecord.key_definitions.length || 
        secRecord.enumerations.length || 
        secRecord.learning_objectives.length ||
        secRecord.code_samples.length ||
        secRecord.table_summaries.length

      if (hasSubstance) {
        sections.push(secRecord)
        representedSourceIds.add(src.id)
        if (path.length) representedHeadingSet.add(pathKey)
      } else {
        omittedSections.push(`${src.title}: ${pathKey || 'Root Section'}`)
      }
    }

    compactedSources.push({
      source_id: src.id,
      title: src.title,
      headings: Array.from(headingPaths.map(p => p.join(' > ')).filter(Boolean)),
      sections,
    })
  }

  // Enforce the global compaction budget. Heuristic per-section slicing alone
  // leaves many-section documents unbounded; this caps the projection at
  // targetChars with fair allocation across all sections.
  let trimmedSectionCount = 0
  if (mode !== 'full' && targetChars > 0) {
    const enforced = enforceCompactionBudget(compactedSources, targetChars)
    totalCompactChars = enforced.totalChars
    trimmedSectionCount = enforced.trimmedSectionCount
  } else {
    totalCompactChars = compactedSources.reduce(
      (acc, s) => acc + s.sections.reduce((a, sec) => a + sectionCompactSize(sec), 0),
      0,
    )
  }

  // Coverage validation
  const valid = representedSourceIds.size === sourcesData.length &&
    omittedSections.length === 0

  const withinBudget = mode === 'full' || targetChars <= 0 || totalCompactChars <= targetChars

  const coverageReport = {
    source_count: sourcesData.length,
    represented_source_count: representedSourceIds.size,
    heading_count: headingSet.size,
    represented_heading_count: representedHeadingSet.size,
    omitted_sections: omittedSections,
    valid,
    budget_chars: targetChars,
    within_budget: withinBudget,
    trimmed_section_count: trimmedSectionCount,
  }

  return {
    schema_version: 'curriculum-source-v1',
    source_fingerprint: fingerprint,
    compaction_version: COMPACTION_VERSION,
    original_char_count: originalCharCount,
    compact_char_count: totalCompactChars,
    sources: compactedSources,
    coverage_report: coverageReport,
  }
}

export async function getOrBuildSourceCompaction({
  db,
  sourceVersionIds,
  userId,
  generationJobId,
  sourceTextFallback,
  sourceTitles,
}: {
  db: Db
  sourceVersionIds: string[]
  userId: string
  generationJobId?: string
  sourceTextFallback?: string
  sourceTitles?: string[]
}): Promise<CompactCurriculumSource> {
  const COMPACTION_VERSION = 'v1.1'
  const sortedIds = [...sourceVersionIds].sort()
  const cacheKey = crypto.createHash('sha256')
    .update(sortedIds.join(',') + '_' + COMPACTION_VERSION)
    .digest('hex')

  const cached = await db.collection('sourceCurriculumCompactions').findOne({
    cache_key: cacheKey,
  })

  if (cached && cached.compact_source) {
    return cached.compact_source as CompactCurriculumSource
  }

  const compactSource = await buildSourceCompaction({
    db,
    sourceVersionIds,
    sourceTextFallback,
    sourceTitles,
  })

  await db.collection('sourceCurriculumCompactions').insertOne({
    _id: crypto.randomUUID() as any,
    user_id: userId,
    generation_job_id: generationJobId || null,
    source_version_ids: sourceVersionIds,
    source_fingerprint: compactSource.source_fingerprint,
    compaction_version: COMPACTION_VERSION,
    cache_key: cacheKey,
    compact_source: compactSource,
    coverage_report: compactSource.coverage_report,
    created_at: new Date(),
    updated_at: new Date(),
  })

  return compactSource
}

