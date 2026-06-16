import type { SourceTeachingProfile } from './sourceProfile'

export type SourceCurriculumIssueCode =
  | 'missing_curriculum'
  | 'missing_topics'
  | 'duplicate_topic_id'
  | 'missing_source_anchor'
  | 'invalid_source_reference'
  | 'missing_anchor_locator'
  | 'unsupported_anchor_locator'
  | 'topic_not_supported_by_source'
  | 'noncovered_topic'
  | 'invalid_concept_group'
  | 'invalid_source_sequence_policy'
  | 'out_of_scope_promoted'
  | 'excessive_root_topics'
  | 'excessive_total_topics'
  | 'map_topic_not_in_curriculum'
  | 'curriculum_topic_missing_from_map'

export type SourceCurriculumIssue = {
  code: SourceCurriculumIssueCode
  message: string
  topicId?: string
  topicTitle?: string
}

export type SourceCurriculumValidationReport = {
  valid: boolean
  issues: SourceCurriculumIssue[]
  metrics: {
    sourceCount: number
    sourceCharacters: number
    rootTopicCount: number
    totalTopicCount: number
    leafTopicCount: number
    rootTopicLimit: number
    totalTopicLimit: number
  }
}

type ValidationOptions = {
  sourceText?: string
  sourceProfile?: SourceTeachingProfile | null
}

type SourceDocument = {
  index: number
  title: string
  body: string
}

type TopicRecord = {
  topic: any
  root: boolean
  leaf: boolean
}

const CONCEPT_GROUPS = new Set(['prequel', 'current', 'sequel'])
const SOURCE_SEQUENCE_POLICIES = new Set([
  'preserve_uploaded_source_order',
  'conceptual_reorder_allowed',
])
const TITLE_STOP_WORDS = new Set([
  'about', 'and', 'basics', 'core', 'for', 'from', 'how', 'introduction',
  'overview', 'the', 'to', 'understanding', 'using', 'what', 'why', 'with',
])

export class SourceCurriculumIntegrityError extends Error {
  readonly code = 'SOURCE_CURRICULUM_INTEGRITY'
  readonly issues: SourceCurriculumIssue[]

  constructor(issues: SourceCurriculumIssue[]) {
    const summary = issues
      .slice(0, 4)
      .map((issue) => issue.message)
      .join(' ')
    super(`Source-grounded curriculum failed integrity validation. ${summary}`.trim())
    this.name = 'SourceCurriculumIntegrityError'
    this.issues = issues
  }
}

function sourceDocuments(sourceText = ''): SourceDocument[] {
  const blocks = sourceText
    .split('\n\n---\n\n')
    .map((value) => value.trim())
    .filter(Boolean)

  return blocks.map((block, position) => {
    const firstNewline = block.indexOf('\n')
    const firstLine = firstNewline >= 0 ? block.slice(0, firstNewline).trim() : ''
    const numbered = firstLine.match(/^Source\s+(\d+):\s*(.+)$/i)
    const legacy = firstLine.match(/^Source:\s*(.+)$/i)
    const hasHeader = Boolean(numbered || legacy)
    return {
      index: numbered ? Number(numbered[1]) : position + 1,
      title: numbered?.[2]?.trim() || legacy?.[1]?.trim() || `Source ${position + 1}`,
      body: hasHeader && firstNewline >= 0 ? block.slice(firstNewline + 1).trim() : block,
    }
  })
}

function collectTopics(curriculum: any): TopicRecord[] {
  const records: TopicRecord[] = []

  function visit(topic: any, root: boolean) {
    if (!topic || typeof topic !== 'object') return
    const children = Array.isArray(topic.children) ? topic.children : []
    records.push({ topic, root, leaf: children.length === 0 })
    for (const child of children) visit(child, false)
  }

  for (const branch of curriculum?.branches ?? []) {
    for (const section of branch?.sections ?? []) {
      for (const topic of section?.topics ?? []) visit(topic, true)
    }
  }

  return records
}

function normalizedTerm(value: unknown) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function uniqueStrings(values: unknown[], max = 30) {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))].slice(0, max)
}

function overlapsBoundary(topicTitle: string, boundary: string) {
  const topic = normalizedTerm(topicTitle)
  const item = normalizedTerm(boundary)
  if (!topic || !item) return false
  if (topic === item) return true
  if (item.length < 5) return false
  return topic.includes(item) || item.includes(topic)
}

function locatorSupported(locator: string, document: SourceDocument) {
  const normalizedLocator = normalizedTerm(
    locator.replace(/^(section|chapter|unit|module|lecture|topic|page)\s+/i, ''),
  )
  if (!normalizedLocator) return false
  const haystack = normalizedTerm(`${document.title}\n${document.body}`)
  if (haystack.includes(normalizedLocator)) return true

  const tokens = normalizedLocator
    .split(' ')
    .filter((token) => token.length >= 3)
  if (!tokens.length) return false
  const matched = tokens.filter((token) => haystack.includes(token)).length
  return matched / tokens.length >= 0.6
}

function topicSupportedByDocument(topicTitle: string, topicDescription: string, document: SourceDocument) {
  const titleTokens = normalizedTerm(topicTitle)
    .split(' ')
    .filter((token) => token.length >= 3 && !TITLE_STOP_WORDS.has(token))
  const haystack = normalizedTerm(`${document.title}\n${document.body}`)
  if (titleTokens.some((token) => haystack.includes(token))) return true

  const descriptionTokens = normalizedTerm(topicDescription)
    .split(' ')
    .filter((token) => token.length >= 4 && !TITLE_STOP_WORDS.has(token))
    .slice(0, 20)
  if (!titleTokens.length && !descriptionTokens.length) return true
  return descriptionTokens.some((token) => haystack.includes(token))
}

function topicLimits({
  sourceCount,
  sourceCharacters,
  profile,
}: {
  sourceCount: number
  sourceCharacters: number
  profile?: SourceTeachingProfile | null
}) {
  const coveredCount = new Set(
    (profile?.scope.covered_topics ?? []).map(normalizedTerm).filter(Boolean),
  ).size
  const conceptualBase = Math.max(1, sourceCount, coveredCount)
  const coverage = profile?.scope.coverage ?? 'partial'
  const documentType = String(profile?.document_type ?? '').toLowerCase()

  let rootTopicLimit: number
  if (coverage === 'narrow') {
    rootTopicLimit = conceptualBase + 1
    if (sourceCount <= 1 && ['chapter', 'lecture_notes', 'slides', 'reference'].includes(documentType)) {
      rootTopicLimit = Math.min(rootTopicLimit, 3)
    }
    const volumeAllowance = Math.max(1, Math.ceil(sourceCharacters / 5_000))
    rootTopicLimit = Math.max(rootTopicLimit, Math.min(volumeAllowance, conceptualBase + 2))
  } else if (coverage === 'full') {
    rootTopicLimit = conceptualBase + Math.max(3, sourceCount * 2)
    rootTopicLimit = Math.max(rootTopicLimit, Math.ceil(sourceCharacters / 5_000))
  } else {
    rootTopicLimit = conceptualBase + Math.max(2, sourceCount)
    const volumeAllowance = Math.max(1, Math.ceil(sourceCharacters / 5_000))
    rootTopicLimit = Math.max(rootTopicLimit, Math.min(volumeAllowance, conceptualBase + 4))
  }

  const volumeTopicLimit = Math.max(1, Math.ceil(sourceCharacters / 900))
  const totalTopicLimit = Math.max(rootTopicLimit * 4, volumeTopicLimit + sourceCount)

  return {
    rootTopicLimit: Math.max(1, rootTopicLimit),
    totalTopicLimit: Math.max(1, totalTopicLimit),
  }
}

export function normalizeSourceGroundedCurriculumBoundary(
  curriculum: any,
  profile?: SourceTeachingProfile | null,
) {
  if (!curriculum || typeof curriculum !== 'object') return curriculum

  const existing = curriculum.out_of_scope && typeof curriculum.out_of_scope === 'object'
    ? curriculum.out_of_scope
    : {}
  const assumed = uniqueStrings([
    ...(Array.isArray(existing.assumed_prerequisites) ? existing.assumed_prerequisites : []),
    ...(profile?.implied_prerequisites ?? []),
    ...(profile?.reconstruction.prerequisite_topics ?? []),
  ])
  const followups = uniqueStrings([
    ...(Array.isArray(existing.mentioned_followups) ? existing.mentioned_followups : []),
    ...(profile?.reconstruction.dependent_topics ?? []),
  ])

  curriculum.out_of_scope = {
    assumed_prerequisites: assumed,
    mentioned_followups: followups,
  }
  return curriculum
}

export function validateSourceGroundedCurriculum(
  curriculum: any,
  options: ValidationOptions = {},
): SourceCurriculumValidationReport {
  const issues: SourceCurriculumIssue[] = []
  const documents = sourceDocuments(options.sourceText)
  const knownSourceNumbers = new Set(documents.map((document) => document.index))
  const records = collectTopics(curriculum)
  const rootTopics = records.filter((record) => record.root)
  const leafTopics = records.filter((record) => record.leaf)
  const sourceCharacters = documents.reduce((sum, document) => sum + document.body.length, 0)
  const limits = topicLimits({
    sourceCount: documents.length,
    sourceCharacters,
    profile: options.sourceProfile,
  })

  if (!curriculum || typeof curriculum !== 'object') {
    issues.push({
      code: 'missing_curriculum',
      message: 'The source-grounded curriculum is missing or malformed.',
    })
  }
  if (!records.length) {
    issues.push({
      code: 'missing_topics',
      message: 'The source-grounded curriculum contains no topics.',
    })
  }
  if (!SOURCE_SEQUENCE_POLICIES.has(String(curriculum?.source_sequence_policy ?? ''))) {
    issues.push({
      code: 'invalid_source_sequence_policy',
      message: 'The curriculum must declare a valid source sequencing policy.',
    })
  }

  const seenIds = new Set<string>()
  const boundaries = [
    ...(curriculum?.out_of_scope?.assumed_prerequisites ?? []),
    ...(curriculum?.out_of_scope?.mentioned_followups ?? []),
  ].map(String)

  for (const { topic } of records) {
    const topicId = String(topic?.id ?? '').trim()
    const topicTitle = String(topic?.title ?? (topicId || 'Untitled topic')).trim()
    const context = { topicId: topicId || undefined, topicTitle }

    if (topicId && seenIds.has(topicId)) {
      issues.push({
        code: 'duplicate_topic_id',
        message: `Topic "${topicTitle}" reuses the id "${topicId}".`,
        ...context,
      })
    }
    if (topicId) seenIds.add(topicId)

    if (String(topic?.source_coverage ?? '') !== 'covered') {
      issues.push({
        code: 'noncovered_topic',
        message: `Topic "${topicTitle}" is not marked as covered by the uploaded sources.`,
        ...context,
      })
    }

    if (!CONCEPT_GROUPS.has(String(topic?.concept_group ?? ''))) {
      issues.push({
        code: 'invalid_concept_group',
        message: `Topic "${topicTitle}" has no valid source concept group.`,
        ...context,
      })
    }

    const anchor = String(topic?.source_anchor ?? '').trim()
    if (!anchor) {
      issues.push({
        code: 'missing_source_anchor',
        message: `Topic "${topicTitle}" has no source anchor.`,
        ...context,
      })
    } else if (documents.length) {
      const match = anchor.match(/\bSource\s+(\d+)\b/i)
      if (!match || !knownSourceNumbers.has(Number(match[1]))) {
        issues.push({
          code: 'invalid_source_reference',
          message: `Topic "${topicTitle}" points to a source that was not uploaded.`,
          ...context,
        })
      } else {
        const locator = anchor
          .slice((match.index ?? 0) + match[0].length)
          .replace(/^[\s:;,.\-\u2013\u2014]+/, '')
          .trim()
        if (locator.length < 3) {
          issues.push({
            code: 'missing_anchor_locator',
            message: `Topic "${topicTitle}" names a source but not the section or passage that teaches it.`,
            ...context,
          })
        } else {
          const document = documents.find((item) => item.index === Number(match[1]))
          if (document && !locatorSupported(locator, document)) {
            issues.push({
              code: 'unsupported_anchor_locator',
              message: `Topic "${topicTitle}" uses a source anchor that cannot be found in the referenced material.`,
              ...context,
            })
          } else if (
            document
            && !topicSupportedByDocument(topicTitle, String(topic?.description ?? ''), document)
          ) {
            issues.push({
              code: 'topic_not_supported_by_source',
              message: `Topic "${topicTitle}" is not supported by the referenced source material.`,
              ...context,
            })
          }
        }
      }
    }

    const promoted = boundaries.find((boundary) => overlapsBoundary(topicTitle, boundary))
    if (promoted) {
      issues.push({
        code: 'out_of_scope_promoted',
        message: `Topic "${topicTitle}" promotes out-of-scope material "${promoted}" into the course.`,
        ...context,
      })
    }
  }

  if (rootTopics.length > limits.rootTopicLimit) {
    issues.push({
      code: 'excessive_root_topics',
      message: `The curriculum creates ${rootTopics.length} Atlas-level topics from material that supports at most about ${limits.rootTopicLimit}.`,
    })
  }
  if (records.length > limits.totalTopicLimit) {
    issues.push({
      code: 'excessive_total_topics',
      message: `The curriculum fragments the sources into ${records.length} topics; the source volume supports at most about ${limits.totalTopicLimit}.`,
    })
  }

  return {
    valid: issues.length === 0,
    issues,
    metrics: {
      sourceCount: documents.length,
      sourceCharacters,
      rootTopicCount: rootTopics.length,
      totalTopicCount: records.length,
      leafTopicCount: leafTopics.length,
      rootTopicLimit: limits.rootTopicLimit,
      totalTopicLimit: limits.totalTopicLimit,
    },
  }
}

export function enforceSourceGroundedCurriculum(
  curriculum: any,
  options: ValidationOptions = {},
) {
  normalizeSourceGroundedCurriculumBoundary(curriculum, options.sourceProfile)
  const report = validateSourceGroundedCurriculum(curriculum, options)
  if (!report.valid) throw new SourceCurriculumIntegrityError(report.issues)
  curriculum.source_validation_report = report
  return curriculum
}

export function validateSourceGroundedMap(curriculum: any, map: any): SourceCurriculumIssue[] {
  const curriculumIds = new Set(
    collectTopics(curriculum)
      .map(({ topic }) => String(topic?.id ?? '').trim())
      .filter(Boolean),
  )
  const mapIds = new Set<string>()
  const issues: SourceCurriculumIssue[] = []

  for (const topic of Array.isArray(map?.topics) ? map.topics : []) {
    const id = String(topic?.id ?? '').trim()
    if (!id) continue
    mapIds.add(id)
    if (!curriculumIds.has(id)) {
      issues.push({
        code: 'map_topic_not_in_curriculum',
        message: `The Atlas map invented topic "${String(topic?.title ?? id)}" outside the validated curriculum.`,
        topicId: id,
        topicTitle: String(topic?.title ?? id),
      })
    }
  }

  for (const id of curriculumIds) {
    if (!mapIds.has(id)) {
      issues.push({
        code: 'curriculum_topic_missing_from_map',
        message: `The Atlas map dropped validated curriculum topic "${id}".`,
        topicId: id,
      })
    }
  }

  return issues
}

export function enforceSourceGroundedMap(curriculum: any, map: any) {
  const issues = validateSourceGroundedMap(curriculum, map)
  if (issues.length) throw new SourceCurriculumIntegrityError(issues)
  return map
}
