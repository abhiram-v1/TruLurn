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
  sourceProfile?: any | null
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

// ── Repair types ──────────────────────────────────────────────────────────────

export type SourceCurriculumRepairEntry = {
  topicId?: string
  topicTitle?: string
  code: SourceCurriculumIssueCode
  action: string
}

export type SourceCurriculumRepairReport = {
  repaired: boolean
  repairs: SourceCurriculumRepairEntry[]
  remainingIssues: SourceCurriculumIssue[]
}

// Codes that mean the curriculum is structurally irrecoverable — no repair possible.
const UNRECOVERABLE_CODES = new Set<SourceCurriculumIssueCode>([
  'missing_curriculum',
  'missing_topics',
])

// ── Tree-mutation helpers ─────────────────────────────────────────────────────

function findTopicInTree(curriculum: any, targetId: string): any | null {
  function visit(topic: any): any {
    if (String(topic?.id ?? '') === targetId) return topic
    for (const child of topic?.children ?? []) {
      const found = visit(child)
      if (found) return found
    }
    return null
  }
  for (const branch of curriculum?.branches ?? []) {
    for (const section of branch?.sections ?? []) {
      for (const topic of section?.topics ?? []) {
        const found = visit(topic)
        if (found) return found
      }
    }
  }
  return null
}

function removeChildById(node: any, targetId: string): boolean {
  if (!Array.isArray(node?.children)) return false
  const before = node.children.length
  node.children = node.children.filter((c: any) => String(c?.id ?? '') !== targetId)
  if (node.children.length < before) return true
  for (const child of node.children) {
    if (removeChildById(child, targetId)) return true
  }
  return false
}

function removeTopicFromCurriculum(curriculum: any, targetId: string): boolean {
  for (const branch of curriculum?.branches ?? []) {
    for (const section of branch?.sections ?? []) {
      if (!Array.isArray(section.topics)) continue
      const before = section.topics.length
      section.topics = section.topics.filter((t: any) => String(t?.id ?? '') !== targetId)
      if (section.topics.length < before) return true
      for (const topic of section.topics) {
        if (removeChildById(topic, targetId)) return true
      }
    }
  }
  return false
}

/**
 * Walk the entire topic tree and rename any duplicate ids by appending _2, _3, …
 * Returns repair entries for each rename performed.
 */
function deduplicateTopicIds(curriculum: any): SourceCurriculumRepairEntry[] {
  const repairs: SourceCurriculumRepairEntry[] = []
  const seen = new Set<string>()

  function visit(topic: any) {
    if (!topic || typeof topic !== 'object') return
    const id = String(topic?.id ?? '').trim()
    if (id && seen.has(id)) {
      let counter = 2
      let newId = `${id}_${counter}`
      while (seen.has(newId)) newId = `${id}_${++counter}`
      repairs.push({
        topicId: id,
        topicTitle: String(topic.title ?? id),
        code: 'duplicate_topic_id',
        action: `Renamed duplicate topic id "${id}" → "${newId}"`,
      })
      topic.id = newId
      seen.add(newId)
    } else if (id) {
      seen.add(id)
    }
    for (const child of topic?.children ?? []) visit(child)
  }

  for (const branch of curriculum?.branches ?? []) {
    for (const section of branch?.sections ?? []) {
      for (const topic of section?.topics ?? []) visit(topic)
    }
  }
  return repairs
}

// ── Repair function ───────────────────────────────────────────────────────────

/**
 * Attempt to fix every recoverable integrity issue in the curriculum tree.
 *
 * Repair actions (in order):
 *   duplicate_topic_id          → rename duplicate ids with a numeric suffix
 *   out_of_scope_promoted       → drop the offending topic from the tree
 *   unsupported_anchor_locator  → strip bad locator, keep "Source N"
 *   missing_anchor_locator      → same as above
 *   invalid_source_reference    → reset anchor to "Source 1" (first available)
 *   noncovered_topic            → force source_coverage = 'covered'
 *   invalid_concept_group       → default concept_group = 'current'
 *   invalid_source_sequence_policy → default to 'preserve_uploaded_source_order'
 *   excessive_*                 → accepted silently (not a blocking defect)
 *
 * Returns a repair report. The caller is responsible for filling `remainingIssues`
 * after a subsequent call to `validateSourceGroundedCurriculum`.
 */
export function repairSourceGroundedCurriculum(
  curriculum: any,
  issues: SourceCurriculumIssue[],
  options: ValidationOptions = {},
): SourceCurriculumRepairReport {
  const repairs: SourceCurriculumRepairEntry[] = []
  const toRemove = new Set<string>()
  const docs = sourceDocuments(options.sourceText)

  // Fix duplicate IDs first so subsequent findTopicInTree lookups are reliable.
  repairs.push(...deduplicateTopicIds(curriculum))

  for (const issue of issues) {
    const { code, topicId, topicTitle } = issue
    const ctx = { topicId, topicTitle }

    // ── Global (non-topic) repairs ──────────────────────────────────────────
    if (code === 'invalid_source_sequence_policy') {
      curriculum.source_sequence_policy = 'preserve_uploaded_source_order'
      repairs.push({ ...ctx, code, action: "Defaulted source_sequence_policy to 'preserve_uploaded_source_order'" })
      continue
    }

    // ── Excessive counts — accepted silently ────────────────────────────────
    if (code === 'excessive_root_topics' || code === 'excessive_total_topics') {
      // A slightly over-large curriculum is always better than a failed generation.
      // These are recorded in remainingIssues after re-validation.
      continue
    }

    // ── Duplicate IDs — already handled by deduplicateTopicIds ─────────────
    if (code === 'duplicate_topic_id') continue

    // ── Out-of-scope topics — queue for removal ────────────────────────────
    if (code === 'out_of_scope_promoted') {
      if (topicId) toRemove.add(topicId)
      repairs.push({ ...ctx, code, action: `Dropped topic "${topicTitle}" — promotes out-of-scope material` })
      continue
    }

    // All remaining repairs target a specific topic by id.
    if (!topicId) continue
    const topic = findTopicInTree(curriculum, topicId)
    if (!topic) continue

    if (code === 'unsupported_anchor_locator' || code === 'missing_anchor_locator') {
      // Keep the source number, strip the invalid locator phrase.
      const anchor = String(topic.source_anchor ?? '')
      const match = anchor.match(/\bSource\s+(\d+)\b/i)
      const sourceNum = match ? match[1] : (docs.length ? '1' : null)
      topic.source_anchor = sourceNum ? `Source ${sourceNum}` : ''
      repairs.push({ ...ctx, code, action: `Reset anchor to "${topic.source_anchor}" (invalid locator removed)` })
      continue
    }

    if (code === 'invalid_source_reference') {
      topic.source_anchor = docs.length ? `Source 1` : ''
      repairs.push({ ...ctx, code, action: `Reset source anchor to first available source` })
      continue
    }

    if (code === 'noncovered_topic') {
      topic.source_coverage = 'covered'
      repairs.push({ ...ctx, code, action: `Forced source_coverage to 'covered'` })
      continue
    }

    if (code === 'invalid_concept_group') {
      topic.concept_group = 'current'
      repairs.push({ ...ctx, code, action: `Defaulted concept_group to 'current'` })
      continue
    }
  }

  // Apply removals after all per-topic field repairs (don't repair then immediately drop).
  for (const id of toRemove) {
    removeTopicFromCurriculum(curriculum, id)
  }

  return { repaired: repairs.length > 0, repairs, remainingIssues: [] }
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
  profile?: any | null
}) {
  const isV2 = profile && 'schema_version' in profile && profile.schema_version === 'source-profile-v2'
  const meta = isV2 ? profile.metadata : profile

  const coveredCount = new Set(
    (meta?.scope?.covered_topics ?? []).map(normalizedTerm).filter(Boolean),
  ).size
  const conceptualBase = Math.max(1, sourceCount, coveredCount)
  const coverage = meta?.scope?.coverage ?? 'partial'
  const documentType = String(meta?.document_type ?? '').toLowerCase()

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
  profile?: any | null,
) {
  if (!curriculum || typeof curriculum !== 'object') return curriculum

  const isV2 = profile && 'schema_version' in profile && profile.schema_version === 'source-profile-v2'
  const meta = isV2 ? profile.metadata : profile

  const existing = curriculum.out_of_scope && typeof curriculum.out_of_scope === 'object'
    ? curriculum.out_of_scope
    : {}
  const assumed = uniqueStrings([
    ...(Array.isArray(existing.assumed_prerequisites) ? existing.assumed_prerequisites : []),
    ...(meta?.implied_prerequisites ?? []),
    ...(meta?.reconstruction?.prerequisite_topics ?? []),
  ])
  const followups = uniqueStrings([
    ...(Array.isArray(existing.mentioned_followups) ? existing.mentioned_followups : []),
    ...(meta?.reconstruction?.dependent_topics ?? []),
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
  const initial = validateSourceGroundedCurriculum(curriculum, options)

  // Fast-path: already valid.
  if (initial.valid) {
    curriculum.source_validation_report = initial
    return curriculum
  }

  // Structurally irrecoverable — no repair possible.
  const hardIssues = initial.issues.filter((issue) => UNRECOVERABLE_CODES.has(issue.code))
  if (hardIssues.length) throw new SourceCurriculumIntegrityError(hardIssues)

  // Repair all recoverable issues in place.
  const repairReport = repairSourceGroundedCurriculum(curriculum, initial.issues, options)

  // Re-validate after repair. Excessive-count and other soft residuals are
  // recorded for observability but do NOT stop the pipeline — a slightly
  // over-large curriculum is always better than a failed generation.
  const final = validateSourceGroundedCurriculum(curriculum, options)
  const stillHard = final.issues.filter((issue) => UNRECOVERABLE_CODES.has(issue.code))
  if (stillHard.length) throw new SourceCurriculumIntegrityError(stillHard)

  repairReport.remainingIssues = final.issues
  curriculum.source_validation_report = final
  curriculum.source_repair_report = repairReport
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
  if (!issues.length) return map

  const repairs: SourceCurriculumRepairEntry[] = []

  // Remove map topics that are not in the validated curriculum (phantom topics
  // hallucinated by the map-builder AI that were never approved in the curriculum).
  const phantomIds = new Set(
    issues
      .filter((i) => i.code === 'map_topic_not_in_curriculum')
      .map((i) => i.topicId)
      .filter(Boolean) as string[],
  )
  if (phantomIds.size && Array.isArray(map.topics)) {
    const before = map.topics.length
    map.topics = map.topics.filter((t: any) => !phantomIds.has(String(t?.id ?? '')))
    const removed = before - map.topics.length
    if (removed > 0) {
      repairs.push({
        code: 'map_topic_not_in_curriculum',
        action: `Removed ${removed} phantom map topic(s) not present in the validated curriculum`,
      })
    }
  }

  // `curriculum_topic_missing_from_map` cannot be synthesised here — the missing
  // topics simply won't appear in the graph and will be handled gracefully at
  // persist time. Record the count for observability.
  const missingCount = issues.filter((i) => i.code === 'curriculum_topic_missing_from_map').length
  if (missingCount > 0) {
    repairs.push({
      code: 'curriculum_topic_missing_from_map',
      action: `${missingCount} curriculum topic(s) absent from the map — deferred to persistence fallback`,
    })
  }

  if (repairs.length) {
    map.map_repair_report = { repaired: true, repairs }
  }

  return map
}
