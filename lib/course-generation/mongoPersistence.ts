import crypto from 'crypto'
import { getDb } from '@/lib/db'
import type { CourseGenerationInput } from '@/lib/course-generation/input'
import type { LessonStyle } from '@/lib/ai/skills/lessonStyle'
import type { CourseResearchReport } from '@/lib/course-generation/research'
import { embedSourceChunkById } from '@/lib/vector/retrieval'

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
    created_at: Date
  }> = []

  for (const block of fileBlocks) {
    const trimmed = block.trim()
    if (!trimmed) continue

    const firstNewline = trimmed.indexOf('\n')
    const firstLine = firstNewline >= 0 ? trimmed.slice(0, firstNewline) : trimmed
    let title: string | null = null
    let body = trimmed

    if (firstLine.startsWith('Source: ')) {
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
        created_at: new Date(),
      })
    }
  }

  if (!docs.length) return

  // Synchronous insert so chunks exist before the first lesson generation request.
  await db.collection('sourceChunks').insertMany(docs)

  // Fire-and-forget embedding — don't block course creation on it.
  for (const doc of docs) {
    embedSourceChunkById(db, String(doc._id)).catch((err) =>
      console.warn('[sourceChunks] Embedding failed for', doc._id, err),
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────

type PersistGeneratedCourseInput = CourseGenerationInput & {
  curriculum: any
  map: any
  userId: string
  learningStyle?: LessonStyle
  learningStyleReason?: string
  researchReport?: CourseResearchReport | null
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

export async function persistGeneratedCourse(input: PersistGeneratedCourseInput): Promise<PersistedGeneratedCourse> {
  const db = await getDb()
  const courseId = crypto.randomUUID()
  const branches = Array.isArray(input.map?.branches) ? input.map.branches : []
  const topics = Array.isArray(input.map?.topics) ? input.map.topics : []
  const structuralEdges = Array.isArray(input.map?.structural_edges) ? input.map.structural_edges : []
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
    progression_policy: {
      mode: input.learningControl,
      allow_agent_pruning: input.learningControl !== 'guided',
      allow_topic_jump: input.learningControl === 'open',
      require_quiz_to_unlock: input.learningControl === 'guided',
    },
    learning_style: input.learningStyle ?? 'conceptual_technical',
    learning_style_reason: input.learningStyleReason ?? null,
    research_confidence: input.researchReport?.research_confidence ?? null,
    source_text: input.sourceText || null,
    source_limitations: input.sourceLimitations,
    summary: courseSummary.summary,
    complexity: courseSummary.complexity,
    structure_reasoning: courseSummary.structure_reasoning,
    branch_count: courseSummary.branch_count,
    topic_count: courseSummary.topic_count,
    status: 'ready',
    created_at: new Date(),
    updated_at: new Date(),
  })

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
  const topicsToInsert = topics.map((topic: any, index: number) => {
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

    return {
      _id: topicId as any,
      course_id: courseId,
      branch_id: topic.branch_id,
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
      sequence_index: Number.isFinite(topic.sequence_index) ? Number(topic.sequence_index) : index,
      recommended_next_ids: (topic.recommended_next_ids || []).map((id: string) => idMap.get(id) ?? id),
      is_optional: Boolean(topic.is_optional),
      covered_by_node_id: topic.covered_by_node_id ? idMap.get(topic.covered_by_node_id) ?? topic.covered_by_node_id : null,
      state: 'locked' as const,    // all start locked; exactly one is activated below
      understanding_level: null,
      prerequisites: (topic.prerequisites || []).map((id: string) => idMap.get(id) ?? id),
      depth: topic.depth ?? null,
      estimated_pages: estimatedPages,
      created_at: new Date(),
      updated_at: new Date(),
    }
  })

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

  // Normalise helper for the branch-id match below (reused in branchesToInsert too).
  function normaliseBranchSlugForActive(raw: string) {
    return String(raw ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  }
  const normFirstBranch = normaliseBranchSlugForActive(firstBranch.id)

  const firstActiveTopic =
    mapActiveLeaf
    ?? topicsToInsert.find((t: any) => {
        const nb = normaliseBranchSlugForActive(String(t.branch_id ?? ''))
        return (nb === normFirstBranch || nb.endsWith(`-${normFirstBranch}`) || normFirstBranch.endsWith(`-${nb}`))
          && isTeachableTopic(t)
      })
    ?? topicsToInsert.find((t: any) => isTeachableTopic(t))
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

  const branchesToInsert = branches.map((branch: any, index: number) => {
    const normBranchId = normaliseBranchSlug(branch.id)
    const branchTopics = topicsToInsert.filter((topic: any) => {
      const normTopicBranchId = normaliseBranchSlug(String(topic.branch_id ?? ''))
      // Exact match after normalisation, or topic branch_id is a courseId-prefixed slug that
      // ends with the normalised branch id (e.g. "courseId:python-basics" → "python-basics").
      return (
        normTopicBranchId === normBranchId ||
        normTopicBranchId.endsWith(`-${normBranchId}`) ||
        normBranchId.endsWith(`-${normTopicBranchId}`)
      )
    })
    const isFirst = index === 0
    const teachableBranchTopics = branchTopics.filter(isTeachableTopic)
    const activeTopic = isFirst ? firstActiveTopic : teachableBranchTopics[0] ?? branchTopics[0]

    return {
      _id: makeStableNodeId(courseId, branch.id) as any,
      branch_key: branch.id,
      course_id: courseId,
      title: branch.title,
      description: input.curriculum?.branches?.find((item: any) => item.id === branch.id)?.description || branch.description || branch.title,
      state: isFirst ? 'in_progress' : 'not_started',
      active_topic_id: activeTopic ? String(activeTopic._id) : null,
      topic_count: teachableBranchTopics.length || branchTopics.length,
      mastered_count: 0,
      created_at: new Date(),
      updated_at: new Date(),
    }
  })

  const edgeKeys = new Set<string>()
  const edgesToInsert = structuralEdges.map((edge: any) => {
    const from = idMap.get(edge.from_topic_id) ?? edge.from_topic_id
    const to = idMap.get(edge.to_topic_id) ?? edge.to_topic_id
    edgeKeys.add(`${from}::${to}::${edge.edge_type ?? 'semantic'}`)
    return {
    _id: crypto.randomUUID() as any,
    course_id: courseId,
    from_topic_id: from,
    to_topic_id: to,
    edge_type: edge.edge_type ?? 'semantic',
    reason: edge.reason ?? null,
    strength: 1,
    created_at: new Date(),
  }})

  for (const topic of topicsToInsert) {
    if (topic.parent_id) {
      const key = `${topic.parent_id}::${topic._id}::hierarchy`
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key)
        edgesToInsert.push({
          _id: crypto.randomUUID() as any,
          course_id: courseId,
          from_topic_id: String(topic.parent_id),
          to_topic_id: String(topic._id),
          edge_type: 'hierarchy',
          reason: `${topic.title} belongs under ${topic.path_titles?.at(-2) ?? 'its parent'}.`,
          strength: 1,
          created_at: new Date(),
        })
      }
    }

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
          strength: 2,
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

  // Chunk and store source text so lesson generation and the doubt agent can
  // retrieve it semantically. Run after all course documents are inserted.
  if (input.sourceText) {
    await createSourceChunks(db, courseId, input.userId, input.sourceText)
  }

  return {
    courseId,
    firstTopicId: firstActiveTopicId,
  }
}
