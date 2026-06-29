import crypto from 'crypto'
import { getDb } from '@/lib/db'
import type { CourseGenerationInput } from '@/lib/course-generation/input'
import { TEACHING_PERSONAS, type TeachingPersonaId } from '@/lib/personas'
import type { CourseResearchReport } from '@/lib/course-generation/research'
import { embedSourceChunkById } from '@/lib/vector/retrieval'
import { attachIngestedSourcesToCourse } from '@/lib/sources/ingestion'
import {
  enforceSourceGroundedCurriculum,
  enforceSourceGroundedMap,
} from '@/lib/course-generation/sourceCurriculumIntegrity'

// ── Source text chunking ──────────────────────────────────────────────────────
// Split source text into ~1500-char chunks with paragraph-boundary awareness.
// Inserted into sourceChunks at course creation so retrieval can find them.

const CHUNK_SIZE = 1500
const CHUNK_OVERLAP = 150

function splitIntoChunks(text: string): string[] {
  if (text.length <= CHUNK_SIZE) {
    const trimmed = text.trim()
    return trimmed.length > 50 ? [trimmed] : []
  }

  const chunks: string[] = []
  let start = 0

  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length)
    let breakAt = end

    // Prefer breaking at a paragraph boundary rather than mid-sentence.
    if (end < text.length) {
      const lastPara = text.lastIndexOf('\n\n', end)
      if (lastPara > start + CHUNK_SIZE * 0.5) breakAt = lastPara + 2
    }

    const chunk = text.slice(start, breakAt).trim()
    if (chunk.length > 50) chunks.push(chunk)

    start = breakAt - CHUNK_OVERLAP
    if (start >= text.length - CHUNK_OVERLAP) break
  }

  return chunks
}

async function createSourceChunks(
  db: Awaited<ReturnType<typeof getDb>>,
  courseId: string,
  userId: string,
  sourceText: string,
): Promise<void> {
  // sourceText format from extractSourceTextFromFormData:
  //   "Source: filename.pdf\n[content]\n\n---\n\nSource: other.pdf\n[content]"
  const fileBlocks = sourceText.split('\n\n---\n\n')
  const docs: Array<{
    _id: any
    course_id: string
    user_id: string
    source_title: string | null
    content: string
    embedding_status: 'pending'
    created_at: Date
  }> = []

  for (const block of fileBlocks) {
    const trimmed = block.trim()
    if (!trimmed) continue

    const firstNewline = trimmed.indexOf('\n')
    const firstLine = firstNewline >= 0 ? trimmed.slice(0, firstNewline) : trimmed
    let title: string | null = null
    let body = trimmed

    const numberedSource = firstLine.match(/^Source\s+\d+:\s*(.+)$/i)
    if (numberedSource) {
      title = numberedSource[1]?.trim() || null
      body = firstNewline >= 0 ? trimmed.slice(firstNewline + 1).trim() : ''
    } else if (firstLine.startsWith('Source: ')) {
      title = firstLine.slice('Source: '.length).trim() || null
      body = firstNewline >= 0 ? trimmed.slice(firstNewline + 1).trim() : ''
    }

    if (!body.trim()) continue

    for (const chunk of splitIntoChunks(body)) {
      docs.push({
        _id: crypto.randomUUID() as any,
        course_id: courseId,
        user_id: userId,
        source_title: title,
        content: chunk,
        embedding_status: 'pending',
        created_at: new Date(),
      })
    }
  }

  if (!docs.length) return

  // Synchronous insert so chunks exist before the first lesson generation request.
  await db.collection('sourceChunks').insertMany(docs)

  // Complete the initial indexing attempt before the course is reported ready.
  const concurrency = 4
  for (let offset = 0; offset < docs.length; offset += concurrency) {
    const batch = docs.slice(offset, offset + concurrency)
    const results = await Promise.allSettled(
      batch.map((doc) => embedSourceChunkById(db, String(doc._id))),
    )
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.warn('[sourceChunks] Embedding failed for', batch[index]._id, result.reason)
      }
    })
  }
}

// ─────────────────────────────────────────────────────────────────────────────

type PersistGeneratedCourseInput = CourseGenerationInput & {
  curriculum: any
  map: any
  userId: string
  teachingPersona?: TeachingPersonaId
  learnerAudience?: import('@/lib/personalization/learnerAudience').LearnerAudienceProfile | null
  researchReport?: CourseResearchReport | null
  generationJobId?: string
}

export type PersistedGeneratedCourse = {
  courseId: string
  firstTopicId: string
}

function makeStableNodeId(courseId: string, rawId: string) {
  return `${courseId}:${rawId}`
}

function isRawPromptTitle(value?: string | null) {
  if (!value) return false
  const clean = value.trim()
  return clean.length > 90 || clean.split(/\s+/).length > 12
}

function titleFromGoals(goals: string) {
  const clean = goals
    .replace(/^i\s+want\s+to\s+learn\s+/i, '')
    .replace(/^learn\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  const sentence = clean.split(/[.!?]/)[0]?.trim() || clean
  const fromMatch = sentence.match(/^(.+?)\s+from\s+(first principles|scratch|basics|fundamentals)\b/i)
  if (fromMatch) {
    const subject = fromMatch[1].replace(/\b(the|a|an)\b/gi, '').trim()
    const qualifier = fromMatch[2]
      .toLowerCase()
      .replace(/\b\w/g, (char) => char.toUpperCase())
    return `${subject} from ${qualifier}`.replace(/\s+/g, ' ').trim()
  }
  return sentence
    .split(/\s+/)
    .slice(0, 6)
    .join(' ')
    .replace(/[,;:]$/, '')
    .trim() || 'Generated curriculum'
}

function resolveCourseTitle(input: PersistGeneratedCourseInput) {
  const generatedTitle = String(input.curriculum?.title ?? '').trim()
  if (generatedTitle && !isRawPromptTitle(generatedTitle)) return generatedTitle

  const topic = String(input.topic ?? '').trim()
  if (topic && !isRawPromptTitle(topic)) return topic

  return titleFromGoals(input.goals)
}

function buildCourseSummary(input: PersistGeneratedCourseInput, branchCount: number, topicCount: number) {
  const title = resolveCourseTitle(input)

  return {
    title,
    topic: input.topic,
    goals: input.goals,
    mode: input.mode,
    learning_control: input.learningControl,
    complexity: input.curriculum?.complexity ?? null,
    structure_reasoning: input.curriculum?.structure_reasoning ?? null,
    branch_count: branchCount,
    topic_count: topicCount,
    summary: input.curriculum?.structure_reasoning
      ?? `${input.topic} roadmap with ${branchCount} branches and ${topicCount} stored topics.`,
  }
}

function findCurriculumTopic(curriculum: any, topicId: string) {
  function visit(topic: any): any {
    if (topic?.id === topicId) return topic
    for (const child of topic?.children ?? []) {
      const found = visit(child)
      if (found) return found
    }
    return null
  }

  for (const branch of curriculum?.branches ?? []) {
    for (const section of branch.sections ?? []) {
      for (const topic of section.topics ?? []) {
        const found = visit(topic)
        if (found) return found
      }
    }
  }

  return null
}

/**
 * Walk the curriculum tree and build a canonical topicId → branchId map.
 *
 * The curriculum is the authoritative source for which branch every topic
 * belongs to. Using this instead of trusting the map builder's topic.branch_id
 * eliminates the entire class of dash/underscore/case inconsistency bugs — the
 * map builder AI never needs to copy the branch id string correctly because we
 * never use what it wrote for branch assignment.
 */
function buildTopicToBranchMap(curriculum: any): Map<string, string> {
  const result = new Map<string, string>()

  function visitTopic(topic: any, branchId: string) {
    if (!topic?.id) return
    result.set(String(topic.id), branchId)
    for (const child of topic.children ?? []) {
      visitTopic(child, branchId)
    }
  }

  for (const branch of curriculum?.branches ?? []) {
    const branchId = String(branch.id ?? '')
    if (!branchId) continue
    for (const section of branch.sections ?? []) {
      for (const topic of section.topics ?? []) {
        visitTopic(topic, branchId)
      }
    }
  }

  return result
}

/**
 * Walk the curriculum tree in study order and build topicId → global sequence.
 *
 * The curriculum's traversal order (branch → section → topic → children) IS the
 * intended study sequence — it's what the learner reviewed and approved in the
 * preview. The map builder's own sequence_index is AI output that is not
 * guaranteed to be globally consistent across branches, and trusting it shuffles
 * everything ordered by sequence: the Atlas, graph staging, and next-topic
 * resolution. Like branch assignment, sequence comes from the curriculum only.
 */
function buildCurriculumSequenceMap(curriculum: any): Map<string, number> {
  const result = new Map<string, number>()
  let cursor = 0

  function visitTopic(topic: any) {
    if (!topic?.id) return
    result.set(String(topic.id), cursor)
    cursor += 1
    for (const child of topic.children ?? []) {
      visitTopic(child)
    }
  }

  for (const branch of curriculum?.branches ?? []) {
    for (const section of branch.sections ?? []) {
      for (const topic of section.topics ?? []) {
        visitTopic(topic)
      }
    }
  }

  return result
}

function normalizeNodeType(topic: any) {
  const type = String(topic.node_type ?? '').trim()
  if (
    type === 'container' ||
    type === 'learning_unit' ||
    type === 'bridge' ||
    type === 'example_unit' ||
    type === 'assessment_unit'
  ) return type

  return topic.children_count > 0 || (Array.isArray(topic.children) && topic.children.length > 0)
    ? 'container'
    : 'learning_unit'
}

function isTeachableTopic(topic: any) {
  return normalizeNodeType(topic) !== 'container'
}

function buildRawTopicLookup(topics: any[]) {
  return new Map(topics.map((topic) => [String(topic.id), topic]))
}

function computeRawPath(topic: any, rawById: Map<string, any>) {
  const path: any[] = []
  const seen = new Set<string>()
  let cursor = topic

  while (cursor && !seen.has(String(cursor.id))) {
    seen.add(String(cursor.id))
    path.unshift(cursor)
    cursor = cursor.parent_id ? rawById.get(String(cursor.parent_id)) : null
  }

  return path.length ? path : [topic]
}

/**
 * Defense-in-depth evidence gate for already-built persistence-shaped topics.
 * Even though enforceSourceGroundedCurriculum/enforceSourceGroundedMap already
 * validate and drop evidence-less topics upstream, persistence is the final
 * boundary before this becomes a real course — never trust it blindly. A
 * teachable topic with zero resolvable `source_refs` is dropped here too,
 * rather than persisted with source_coverage stamped "covered." Containers
 * are exempt: they are organizational, and their evidence lives on teachable
 * descendants.
 */
export function dropTeachableTopicsWithoutEvidence<T extends { node_type: string; source_refs: string[]; title?: string; _id?: unknown }>(
  topics: T[],
): { topics: T[]; dropped: string[] } {
  const dropped: string[] = []
  const kept = topics.filter((topic) => {
    if (topic.node_type === 'container') return true
    if (Array.isArray(topic.source_refs) && topic.source_refs.length > 0) return true
    dropped.push(String(topic.title ?? topic._id))
    return false
  })
  return { topics: kept, dropped }
}

export async function persistGeneratedCourse(input: PersistGeneratedCourseInput): Promise<PersistedGeneratedCourse> {
  if (input.mode === 'source_grounded') {
    input.curriculum = enforceSourceGroundedCurriculum(input.curriculum, {
      sourceText: input.sourceText,
      sourceProfile: input.sourceProfile,
      compactCurriculumSource: input.compactCurriculumSource,
    })
    enforceSourceGroundedMap(input.curriculum, input.map)
  }

  const db = await getDb()

  // Idempotency: a prior attempt for this exact generation job may have
  // already persisted a course before the job doc itself was updated with
  // course_id (e.g. the process crashed in that exact window) — the
  // generation job's own retry would otherwise call this function again and
  // create a second, orphaned course. A course already fully "ready" is
  // reused as-is; one still stuck "generating" never finished, so it (and
  // anything written for it) is cleared and persisted fresh below rather than
  // guessing how to resume an unknown partial state.
  if (input.generationJobId) {
    const existingCourse = await db.collection('courses').findOne({
      generation_job_id: input.generationJobId,
      user_id: input.userId,
    })
    if (existingCourse?.status === 'ready') {
      const firstTopic = await db.collection('topics').findOne(
        { course_id: String(existingCourse._id), state: 'active', node_type: { $ne: 'container' } },
        { projection: { _id: 1 } },
      )
      if (firstTopic) {
        return { courseId: String(existingCourse._id), firstTopicId: String(firstTopic._id) }
      }
    } else if (existingCourse) {
      const staleCourseId = String(existingCourse._id)
      await Promise.all([
        db.collection('courses').deleteOne({ _id: existingCourse._id }),
        db.collection('topics').deleteMany({ course_id: staleCourseId }),
        db.collection('branches').deleteMany({ course_id: staleCourseId }),
        db.collection('topicEdges').deleteMany({ course_id: staleCourseId }),
        db.collection('curricula').deleteOne({ _id: existingCourse._id }),
        db.collection('courseSummaries').deleteMany({ course_id: staleCourseId }),
        db.collection('topicSummaries').deleteMany({ course_id: staleCourseId }),
      ])
    }
  }

  const courseId = crypto.randomUUID()
  const branches = Array.isArray(input.map?.branches) ? input.map.branches : []
  const topics = Array.isArray(input.map?.topics) ? input.map.topics : []
  const structuralEdges = Array.isArray(input.map?.structural_edges) ? input.map.structural_edges : []
  const graphProvenance = input.map?.provenance ?? null
  const firstBranch = branches[0]

  if (!firstBranch) throw new Error('Generated roadmap has no branches.')
  if (!topics.length) throw new Error('Generated roadmap has no topics.')

  const courseSummary = buildCourseSummary(input, branches.length, topics.length)

  await db.collection('courses').insertOne({
    _id: courseId as any,
    user_id: input.userId,
    title: courseSummary.title,
    topic: input.topic,
    goals: input.goals || null,
    mode: input.mode,
    learning_control: input.learningControl,
    course_depth: input.courseDepth,
    knowledge_level: input.knowledgeLevel,
    learning_purpose: input.learningPurpose,
    progression_policy: {
      mode: input.learningControl,
      allow_agent_pruning: input.learningControl !== 'guided',
      allow_topic_jump: input.learningControl === 'open',
      require_quiz_to_unlock: input.learningControl === 'guided',
    },
    teaching_persona: input.teachingPersona ?? 'immersive_builder',
    teaching_persona_version: TEACHING_PERSONAS[input.teachingPersona ?? 'immersive_builder'].version,
    // Who this learner is (derived from goals/setup, correctable via the agent).
    // Every user-facing generator reads it so nothing assumes a school student.
    learner_audience: input.learnerAudience ?? null,
    research_confidence: input.researchReport?.research_confidence ?? null,
    source_text: input.sourceText || null,
    source_document_ids: input.sourceDocumentIds ?? [],
    source_version_ids: input.sourceVersionIds ?? [],
    // Teaching-style profile of the uploaded sources — lesson generation reads
    // this to write every page in the instructor's voice.
    source_profile: input.sourceProfile ?? null,
    source_limitations: input.sourceLimitations,
    // Source-based learning boundary: background the sources assume and
    // follow-ups they only mention. Surfaced to the student, never taught.
    out_of_scope: input.mode === 'source_grounded'
      ? {
          assumed_prerequisites: Array.isArray((input.curriculum as any)?.out_of_scope?.assumed_prerequisites)
            ? (input.curriculum as any).out_of_scope.assumed_prerequisites.map(String).slice(0, 15)
            : [],
          mentioned_followups: Array.isArray((input.curriculum as any)?.out_of_scope?.mentioned_followups)
            ? (input.curriculum as any).out_of_scope.mentioned_followups.map(String).slice(0, 15)
            : [],
        }
      : null,
    summary: courseSummary.summary,
    complexity: courseSummary.complexity,
    structure_reasoning: courseSummary.structure_reasoning,
    branch_count: courseSummary.branch_count,
    topic_count: courseSummary.topic_count,
    // Starts "generating" and only flips to "ready" once every structural
    // collection (branches/topics/edges/curricula/summaries) below has been
    // written — never insert this as "ready" first. A crash partway through
    // used to leave a "ready" course with zero topics, indistinguishable from
    // a real one until a learner opened it.
    status: 'generating',
    generation_job_id: input.generationJobId ?? null,
    validation_report: (input.map as any)?.validation_report ?? null,
    graph_schema_version: graphProvenance?.schema_version ?? 'legacy-v1',
    graph_generation_provenance: graphProvenance,
    graph_generation_revision: Number(graphProvenance?.generation_revision ?? 0),
    source_curriculum_validation: input.mode === 'source_grounded'
      ? (input.curriculum as any)?.source_validation_report ?? null
      : null,
    source_curriculum_model_repair: input.mode === 'source_grounded'
      ? (input.curriculum as any)?.source_model_repair_report ?? null
      : null,
    curriculum_rollout: (input.curriculum as any)?.curriculum_rollout ?? null,
    created_at: new Date(),
    updated_at: new Date(),
  })

  // Derive canonical branchId for every topic from the curriculum tree — not from
  // whatever the map builder AI wrote in topic.branch_id. This is the single source
  // of truth for branch assignment and removes the dash/underscore/case class of bugs.
  const topicToBranchMap = buildTopicToBranchMap(input.curriculum)
  // Same principle for study order: global sequence comes from curriculum traversal.
  const curriculumSequence = buildCurriculumSequenceMap(input.curriculum)

  const idMap = new Map<string, string>()
  topics.forEach((topic: any) => {
    idMap.set(topic.id, makeStableNodeId(courseId, topic.id))
  })
  const rawById = buildRawTopicLookup(topics)
  const childCountByRawId = new Map<string, number>()
  for (const topic of topics) {
    if (!topic.parent_id) continue
    const parentId = String(topic.parent_id)
    childCountByRawId.set(parentId, (childCountByRawId.get(parentId) ?? 0) + 1)
  }

  // Build all topics as locked first, then activate exactly one below.
  let topicsToInsert = topics.map((topic: any, index: number) => {
    const topicId = idMap.get(topic.id) ?? makeStableNodeId(courseId, topic.id || crypto.randomUUID())
    const curriculumTopic = findCurriculumTopic(input.curriculum, topic.id)
    const description = curriculumTopic?.description ?? topic.description ?? null
    const rawPath = Array.isArray(topic.path_ids) && topic.path_ids.length
      ? topic.path_ids.map((id: string) => rawById.get(String(id))).filter(Boolean)
      : computeRawPath(topic, rawById)
    const pathIds = rawPath.map((pathTopic: any) => idMap.get(pathTopic.id) ?? makeStableNodeId(courseId, pathTopic.id))
    const pathTitles = Array.isArray(topic.path_titles) && topic.path_titles.length
      ? topic.path_titles
      : rawPath.map((pathTopic: any) => String(pathTopic.title ?? pathTopic.id))
    const childrenCount = Number.isFinite(topic.children_count)
      ? Number(topic.children_count)
      : childCountByRawId.get(String(topic.id)) ?? 0
    const nodeType = normalizeNodeType({ ...topic, children_count: childrenCount })
    const teachable = nodeType !== 'container'
    const estimatedPages = teachable
      ? Math.max(1, Number(topic.estimated_pages ?? topic.total_pages_planned ?? 1))
      : Math.max(0, Number(topic.estimated_pages ?? topic.total_pages_planned ?? 0))

    // Use the curriculum-derived branch id. Fall back to the map builder's value only
    // for topics the curriculum doesn't know about (shouldn't happen, but be safe).
    const canonicalBranchId = topicToBranchMap.get(topic.id) ?? topic.branch_id

    // ── Graph tags (AI-emitted; remap any id keys to stable ids) ──
    const importanceTag = ['core', 'supporting'].includes(String(curriculumTopic?.importance ?? topic.importance))
      ? String(curriculumTopic?.importance ?? topic.importance)
      : null
    const roleTag = ['foundation', 'mechanism', 'application', 'tool', 'theory'].includes(String(curriculumTopic?.role ?? topic.role))
      ? String(curriculumTopic?.role ?? topic.role)
      : null
    const spineCandidate = Boolean(curriculumTopic?.spine_candidate ?? topic.spine_candidate ?? false)
    const spineLevel = Number.isFinite(curriculumTopic?.spine_level ?? topic.spine_level)
      ? Number(curriculumTopic?.spine_level ?? topic.spine_level)
      : 0
    const sourceRefs = Array.isArray(topic.source_refs) ? topic.source_refs.map(String) : []
    // Source-grounded canonical topics have already passed the hard curriculum
    // boundary validator. Legacy "inferred" coverage is never persisted here.
    // Only stamp "covered" when the topic actually cites resolvable evidence —
    // blanket-stamping every source-grounded topic regardless of source_refs
    // let partial uploaded material silently present itself as a fully
    // covered course.
    const sourceCoverage = input.mode === 'source_grounded'
      ? (sourceRefs.length > 0 ? 'covered' : null)
      : ['covered', 'inferred'].includes(String(curriculumTopic?.source_coverage ?? topic.source_coverage))
        ? String(curriculumTopic?.source_coverage ?? topic.source_coverage)
        : null
    // Source-based organization: prequel (foundations) / current / sequel
    // (next steps), all detected within the uploaded material itself.
    const conceptGroup = ['prequel', 'current', 'sequel'].includes(String(curriculumTopic?.concept_group ?? topic.concept_group))
      ? String(curriculumTopic?.concept_group ?? topic.concept_group)
      : null
    const sourceAnchor = String(curriculumTopic?.source_anchor ?? topic.source_anchor ?? '').trim() || null
    // Prefer the validated map topic's strengths (sanitizeGeneratedMap rewrote them);
    // fall back to the raw curriculum tag only when validation didn't run.
    const rawStrength = (topic.prerequisite_strength ?? curriculumTopic?.prerequisite_strength) as
      | Record<string, string> | undefined
    const prerequisiteStrength: Record<string, string> = {}
    if (rawStrength && typeof rawStrength === 'object') {
      for (const [rawId, strength] of Object.entries(rawStrength)) {
        if (strength !== 'hard' && strength !== 'soft') continue
        prerequisiteStrength[idMap.get(rawId) ?? rawId] = strength
      }
    }

    return {
      _id: topicId as any,
      course_id: courseId,
      branch_id: canonicalBranchId,
      section: topic.section || 'Core',
      title: topic.title,
      description,
      summary: description,
      parent_id: topic.parent_id ? idMap.get(topic.parent_id) ?? null : null,
      path_ids: pathIds,
      path_titles: pathTitles,
      depth_level: Number.isFinite(topic.depth_level) ? Number(topic.depth_level) : Math.max(0, pathIds.length - 1),
      node_type: nodeType,
      is_leaf: topic.is_leaf !== undefined ? Boolean(topic.is_leaf) : childrenCount === 0,
      children_count: childrenCount,
      learning_depth: topic.learning_depth ?? (topic.depth === 'critical' ? 'deep' : topic.depth === 'light' ? 'overview' : 'standard'),
      position: Number.isFinite(topic.position) ? topic.position : index,
      // Curriculum traversal order first; the map builder's own sequence_index is
      // only a fallback for topics the curriculum doesn't know about.
      sequence_index: curriculumSequence.get(String(topic.id))
        ?? (Number.isFinite(topic.sequence_index) ? Number(topic.sequence_index) : index),
      recommended_next_ids: (topic.recommended_next_ids || []).map((id: string) => idMap.get(id) ?? id),
      is_optional: Boolean(topic.is_optional),
      covered_by_node_id: topic.covered_by_node_id ? idMap.get(topic.covered_by_node_id) ?? topic.covered_by_node_id : null,
      state: 'locked' as const,    // all start locked; exactly one is activated below
      understanding_level: null,
      prerequisites: (topic.prerequisites || []).map((id: string) => idMap.get(id) ?? id),
      prerequisite_strength: prerequisiteStrength,
      depth: topic.depth ?? null,
      estimated_pages: estimatedPages,
      // AI graph tags (null when the AI did not supply them — graph falls back to heuristics)
      importance_tag: importanceTag,
      role: roleTag,
      spine_candidate: spineCandidate,
      spine_level: spineLevel,
      source_coverage: sourceCoverage,
      concept_group: conceptGroup,
      source_anchor: sourceAnchor,
      source_refs: sourceRefs,
      generation_origin: graphProvenance ? 'generated' : 'legacy',
      generation_revision: Number(graphProvenance?.generation_revision ?? 0),
      created_at: new Date(),
      updated_at: new Date(),
    }
  })

  if (input.mode === 'source_grounded') {
    const { topics: gated, dropped } = dropTeachableTopicsWithoutEvidence(topicsToInsert)
    if (dropped.length) {
      console.warn(
        `[persistGeneratedCourse] Dropped ${dropped.length} source-grounded topic(s) with no resolvable evidence: ${dropped.join(', ')}`,
      )
    }
    if (!gated.some((topic: any) => topic.node_type !== 'container')) {
      throw new Error(
        'Every topic in this source-grounded course lacked resolvable source evidence after the evidence gate. Refusing to persist an evidence-free course.',
      )
    }
    topicsToInsert = gated
  }

  // Exactly one LEAF topic starts active: the mapBuilder's designated active topic in the
  // first branch, but only if it is a teachable leaf. Containers cannot be "active" in the
  // sense the learn page needs — it would redirect to a locked child and show "Locked topic".
  const mapActiveId = firstBranch.active_topic_id
    ? idMap.get(firstBranch.active_topic_id) ?? null
    : null

  // Resolve the candidate from mapActiveId, but reject it if it is a container.
  const mapActiveCandidate = mapActiveId
    ? topicsToInsert.find((t: any) => String(t._id) === mapActiveId) ?? null
    : null
  const mapActiveLeaf = mapActiveCandidate && isTeachableTopic(mapActiveCandidate)
    ? mapActiveCandidate
    : null

  // The first branch's canonical id — topics now carry exactly this string.
  const firstBranchCanonicalId = String(
    (input.curriculum?.branches ?? [])[0]?.id ?? firstBranch.id ?? ''
  )

  // Fallbacks resolve in study order (sequence_index), not map-array order.
  const bySequence = (candidates: any[]) =>
    candidates.reduce(
      (best: any, t: any) =>
        !best || Number(t.sequence_index ?? 0) < Number(best.sequence_index ?? 0) ? t : best,
      null,
    )
  const firstActiveTopic =
    mapActiveLeaf
    // topics now carry the canonical branch id, so a simple equality check is enough.
    ?? bySequence(topicsToInsert.filter((t: any) => t.branch_id === firstBranchCanonicalId && isTeachableTopic(t)))
    ?? bySequence(topicsToInsert.filter((t: any) => isTeachableTopic(t)))
    ?? topicsToInsert[0]

  // Mutate the chosen leaf and all its ancestor containers to active.
  ;(firstActiveTopic as any).state = 'active'
  for (const ancestorId of firstActiveTopic.path_ids ?? []) {
    const ancestor = topicsToInsert.find((topic: any) => String(topic._id) === String(ancestorId))
    if (ancestor) ancestor.state = 'active'
  }

  const firstActiveTopicId = String(firstActiveTopic._id)

  // Normalise a branch id slug so LLM inconsistencies (dash vs underscore, case) don't
  // break the match between branch.id and topic.branch_id.
  function normaliseBranchSlug(raw: string) {
    return String(raw ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  }

  // "First branch" means the CURRICULUM's first branch — the map builder's branch
  // array order is AI output and may differ. Fall back to map index 0 only when no
  // map branch resolves to the curriculum's first branch.
  const normFirstBranch = normaliseBranchSlug(firstBranchCanonicalId)
  const canonicalIdOfMapBranch = (branch: any): string => {
    const curriculumBranch = (input.curriculum?.branches ?? []).find(
      (b: any) => normaliseBranchSlug(String(b.id ?? '')) === normaliseBranchSlug(String(branch.id ?? ''))
    )
    return String(curriculumBranch?.id ?? branch.id ?? '')
  }
  const anyBranchMatchesFirst = branches.some(
    (branch: any) => normaliseBranchSlug(canonicalIdOfMapBranch(branch)) === normFirstBranch,
  )

  const branchesToInsert = branches.map((branch: any, index: number) => {
    // Canonical branch id from the curriculum (same source topics now use).
    // Use the curriculum branch record directly so the stored branch_key is always
    // the curriculum's own id, never the potentially-inconsistent map builder copy.
    const canonicalBranchId = canonicalIdOfMapBranch(branch)
    const curriculumBranch = (input.curriculum?.branches ?? []).find(
      (b: any) => normaliseBranchSlug(String(b.id ?? '')) === normaliseBranchSlug(String(canonicalBranchId))
    )

    // Topics were written with canonicalBranchId from the curriculum map, so a
    // simple normalised-exact match is now sufficient — no fuzzy endsWith needed.
    const normBranchId = normaliseBranchSlug(canonicalBranchId)
    const branchTopics = topicsToInsert.filter((topic: any) => {
      return normaliseBranchSlug(String(topic.branch_id ?? '')) === normBranchId
    })
    const isFirst = anyBranchMatchesFirst
      ? normBranchId === normFirstBranch
      : index === 0
    // Study order, not map-array order — the branch entry point is its first
    // teachable topic in the curriculum sequence.
    const teachableBranchTopics = branchTopics
      .filter(isTeachableTopic)
      .sort((a: any, b: any) => Number(a.sequence_index ?? 0) - Number(b.sequence_index ?? 0))
    const activeTopic = isFirst ? firstActiveTopic : teachableBranchTopics[0] ?? branchTopics[0]

    return {
      _id: makeStableNodeId(courseId, canonicalBranchId) as any,
      branch_key: canonicalBranchId,
      course_id: courseId,
      title: curriculumBranch?.title ?? branch.title,
      description: curriculumBranch?.description ?? branch.description ?? branch.title,
      state: isFirst ? 'in_progress' : 'not_started',
      active_topic_id: activeTopic ? String(activeTopic._id) : null,
      topic_count: teachableBranchTopics.length || branchTopics.length,
      mastered_count: 0,
      created_at: new Date(),
      updated_at: new Date(),
    }
  })

  const edgeKeys = new Set<string>()
  const edgesToInsert = structuralEdges
    // Hierarchy edges duplicate parent_id/path_ids, already stored on every
    // topic and used directly by the layout — no render layer has ever
    // displayed this edge type, so persisting it was pure dead weight.
    .filter((edge: any) => String(edge.edge_type) !== 'hierarchy')
    .map((edge: any) => {
    const from = idMap.get(edge.from_topic_id) ?? edge.from_topic_id
    const to = idMap.get(edge.to_topic_id) ?? edge.to_topic_id
    const edgeType = ['prerequisite', 'recommended', 'semantic'].includes(String(edge.edge_type))
      ? String(edge.edge_type)
      : 'semantic'
    edgeKeys.add(`${from}::${to}::${edgeType}`)
    return {
      _id: crypto.randomUUID() as any,
      course_id: courseId,
      from_topic_id: from,
      to_topic_id: to,
      edge_type: edgeType,
      reason: edge.reason ?? null,
      source_refs: Array.isArray(edge.source_refs) ? edge.source_refs.map(String) : [],
      generation_origin: graphProvenance ? 'generated' : 'legacy',
      generation_revision: Number(graphProvenance?.generation_revision ?? 0),
      strength: edgeType === 'prerequisite' ? 3 : edgeType === 'recommended' ? 2 : 1,
      created_at: new Date(),
    }
  })

  for (const topic of topicsToInsert) {
    for (const prereqId of topic.prerequisites ?? []) {
      const key = `${prereqId}::${topic._id}::prerequisite`
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key)
        edgesToInsert.push({
          _id: crypto.randomUUID() as any,
          course_id: courseId,
          from_topic_id: String(prereqId),
          to_topic_id: String(topic._id),
          edge_type: 'prerequisite',
          reason: `${prereqId} is a prerequisite for ${topic.title}.`,
          source_refs: Array.isArray(topic.source_refs) ? topic.source_refs.map(String) : [],
          generation_origin: graphProvenance ? 'generated' : 'legacy',
          generation_revision: Number(graphProvenance?.generation_revision ?? 0),
          // Match structural prerequisite edges (strength 3) — the same relationship
          // must not render at a different weight depending on which source emitted it.
          strength: 3,
          created_at: new Date(),
        })
      }
    }
  }

  // Preserve explicit recommendations from the curriculum rather than manufacturing
  // a learning chain for every pair of neighboring topics.
  for (const topic of topicsToInsert) {
    for (const nextId of topic.recommended_next_ids ?? []) {
      if (!topicsToInsert.some((candidate: any) => String(candidate._id) === String(nextId))) continue
      const key = `${topic._id}::${nextId}::recommended`
      if (edgeKeys.has(key)) continue
      edgeKeys.add(key)
      edgesToInsert.push({
        _id: crypto.randomUUID() as any,
        course_id: courseId,
        from_topic_id: String(topic._id),
        to_topic_id: String(nextId),
        edge_type: 'recommended',
        reason: `"${topic.title}" is a useful next step before continuing the course.`,
        source_refs: Array.isArray(topic.source_refs) ? topic.source_refs.map(String) : [],
        generation_origin: graphProvenance ? 'generated' : 'legacy',
        generation_revision: Number(graphProvenance?.generation_revision ?? 0),
        strength: 2,
        created_at: new Date(),
      })
    }
  }

  // Sequence edges are intentionally source-grounded only. AI-teacher courses
  // used to get an equivalent auto-generated edge for every pair of
  // neighboring topics (reason text `Study "X" before "Y".`) — that was
  // deliberately removed; app/api/graph/[courseId]/route.ts still filters out
  // any leftover ones from old data (`isLegacyManufacturedSequence`). Source
  // mode keeps this because there's a real, citable fact to encode (the
  // material's own order); for AI-teacher mode it amounted to manufacturing a
  // learning chain for every neighboring pair regardless of any real
  // dependency, so it stays on prerequisites + recommended only.
  if (input.mode === 'source_grounded') {
    const teachableByBranch = new Map<string, Array<(typeof topicsToInsert)[number]>>()
    for (const topic of topicsToInsert) {
      if (!isTeachableTopic(topic)) continue
      const branchId = String(topic.branch_id)
      if (!teachableByBranch.has(branchId)) teachableByBranch.set(branchId, [])
      teachableByBranch.get(branchId)!.push(topic)
    }

    for (const orderedTopics of teachableByBranch.values()) {
      orderedTopics.sort((a, b) => Number(a.sequence_index ?? a.position ?? 0) - Number(b.sequence_index ?? b.position ?? 0))
      for (let i = 0; i < orderedTopics.length - 1; i++) {
        const from = String(orderedTopics[i]._id)
        const to = String(orderedTopics[i + 1]._id)
        const key = `${from}::${to}::sequence`
        if (edgeKeys.has(key)) continue
        edgeKeys.add(key)
        edgesToInsert.push({
          _id: crypto.randomUUID() as any,
          course_id: courseId,
          from_topic_id: from,
          to_topic_id: to,
          edge_type: 'sequence',
          reason: `The uploaded material places "${orderedTopics[i].title}" before "${orderedTopics[i + 1].title}".`,
          source_refs: Array.from(new Set([
            ...(Array.isArray(orderedTopics[i].source_refs) ? orderedTopics[i].source_refs : []),
            ...(Array.isArray(orderedTopics[i + 1].source_refs) ? orderedTopics[i + 1].source_refs : []),
          ])).map(String),
          generation_origin: graphProvenance ? 'generated' : 'legacy',
          generation_revision: Number(graphProvenance?.generation_revision ?? 0),
          strength: 3,
          created_at: new Date(),
        })
      }
    }
  }

  await db.collection('branches').insertMany(branchesToInsert)
  await db.collection('topics').insertMany(topicsToInsert)
  if (edgesToInsert.length) {
    await db.collection('topicEdges').insertMany(edgesToInsert)
  }
  // Preserve the raw curriculum tree and map output for future graph re-derivation.
  await db.collection('curricula').insertOne({
    _id: courseId as any,
    course_id: courseId,
    curriculum: input.curriculum ?? null,
    map: input.map ?? null,
    graph_schema_version: graphProvenance?.schema_version ?? 'legacy-v1',
    graph_generation_provenance: graphProvenance,
    graph_generation_revision: Number(graphProvenance?.generation_revision ?? 0),
    created_at: new Date(),
  })
  await db.collection('courseSummaries').insertOne({
    _id: crypto.randomUUID() as any,
    course_id: courseId,
    user_id: input.userId,
    ...courseSummary,
    created_at: new Date(),
  })
  if (input.researchReport) {
    await db.collection('courseResearchReports').insertOne({
      _id: crypto.randomUUID() as any,
      course_id: courseId,
      user_id: input.userId,
      mode: input.mode,
      goals: input.goals,
      ...input.researchReport,
      created_at: new Date(),
    })
  }
  await db.collection('topicSummaries').insertMany(
    topicsToInsert.map((topic: any) => ({
      _id: crypto.randomUUID() as any,
      course_id: courseId,
      topic_id: String(topic._id),
      title: topic.title,
      summary: topic.summary ?? `${topic.title} is part of the ${topic.section} section.`,
      key_concepts: [],
      created_at: new Date(),
    }))
  )

  // Every structural collection above succeeded — the course is now genuinely
  // navigable. Source-text chunking below is best-effort (embedding failures
  // are already caught per-chunk) and intentionally does not gate this flip.
  await db.collection('courses').updateOne(
    { _id: courseId as any },
    { $set: { status: 'ready', updated_at: new Date() } },
  )

  // Chunk and store source text so lesson generation and the doubt agent can
  // retrieve it semantically. Run after all course documents are inserted.
  if (input.sourceVersionIds?.length) {
    const materialized = await attachIngestedSourcesToCourse({
      db,
      userId: input.userId,
      generationJobId: input.generationJobId,
      courseId,
      sourceVersionIds: input.sourceVersionIds,
    })
    const concurrency = 4
    for (let offset = 0; offset < materialized.pendingChunkIds.length; offset += concurrency) {
      await Promise.allSettled(
        materialized.pendingChunkIds
          .slice(offset, offset + concurrency)
          .map((chunkId) => embedSourceChunkById(db, chunkId)),
      )
    }
  } else if (input.sourceText) {
    await createSourceChunks(db, courseId, input.userId, input.sourceText)
  }

  return {
    courseId,
    firstTopicId: firstActiveTopicId,
  }
}
