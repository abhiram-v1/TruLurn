import crypto from 'crypto'
import type { Db } from 'mongodb'

export type CompactSourceSection = {
  source_id: string
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
      result.push(`\n## Section: ${path}`)
      
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
  const COMPACTION_VERSION = 'v1'
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
        
        // Count characters
        totalCompactChars += secRecord.opening_excerpt.length + 
          secRecord.key_definitions.join('').length +
          secRecord.enumerations.join('').length +
          secRecord.learning_objectives.join('').length +
          secRecord.code_samples.join('').length +
          secRecord.table_summaries.join('').length
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

  // Coverage validation
  const valid = representedSourceIds.size === sourcesData.length && 
    omittedSections.length === 0

  const coverageReport = {
    source_count: sourcesData.length,
    represented_source_count: representedSourceIds.size,
    heading_count: headingSet.size,
    represented_heading_count: representedHeadingSet.size,
    omitted_sections: omittedSections,
    valid,
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
  const COMPACTION_VERSION = 'v1'
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

