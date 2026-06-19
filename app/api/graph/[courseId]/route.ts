import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { getCachedCourse, getCachedGraphData } from '@/lib/cache/courseData'
import { normalizeGraphTopicHierarchy, transformToGraphData, type RawRecallStats } from '@/lib/graph/transform'

// GET /api/graph/[courseId]?view=knowledge|reference
//
// knowledge (default) — the learner's personal graph: only concepts they have
//   actually touched (learned, in progress, or needing review), the connections
//   they created themselves, and the AI prerequisite links between touched
//   concepts as faint guidance. Grows as they learn.
// reference — the full AI-generated map: every planned concept and dependency.
//   Kept as a lightweight orientation layer, not the primary representation.

export async function GET(
  request: Request,
  { params }: { params: { courseId: string } },
) {
  try {
    const userId = await getRequiredUserId()
    const { courseId } = params
    const url = new URL(request.url)
    const view = url.searchParams.get('view') === 'reference' ? 'reference' : 'knowledge'
    const db = await getDb()

    const course = await getCachedCourse(db, courseId, userId)
    if (!course) {
      return NextResponse.json({ error: 'Course not found.' }, { status: 404 })
    }

    // The graph payload (heavy layout + cascade + critical-path computation) is
    // cached per course/user/view with a short TTL and invalidated on graph
    // writes (state updates, connections). Rapid re-renders/pans reuse it.
    const payload = await getCachedGraphData(courseId, userId, view, async () => {
    const [topics, branches, topicEdges, examSessions, doubtAgg, userConnections, graphNodeMeta] = await Promise.all([
      db.collection('topics').find({ course_id: courseId }).sort({ position: 1 }).toArray(),
      db.collection('branches').find({ course_id: courseId }).toArray(),
      db.collection('topicEdges').find({ course_id: courseId }).toArray(),
      // Most recent completed exam session per topic — for decay + false confidence
      db.collection('examSessions')
        .find({ course_id: courseId, user_id: userId, status: 'completed' })
        .sort({ completed_at: -1 })
        .project({ topic_id: 1, completed_at: 1, summary: 1 })
        .toArray(),
      // Doubt message count per topic
      db.collection('doubtMessages')
        .aggregate([
          { $match: { course_id: courseId, user_id: userId } },
          { $group: { _id: '$topic_id', count: { $sum: 1 } } },
        ])
        .toArray(),
      // Learner-created concept connections
      db.collection('userConnections')
        .find({ course_id: courseId, user_id: userId })
        .toArray(),
      // Graph manager: per-node confidence + review states from interaction analysis
      db.collection('graphNodeMeta')
        .find({ course_id: courseId, user_id: userId })
        .project({ topic_id: 1, confidence_score: 1, review_state: 1 })
        .toArray(),
    ])

    // Build lookup maps for the intelligence layer
    const lastExamByTopic = new Map<string, { completedAt: Date; falseConfidence: boolean }>()
    for (const session of examSessions) {
      const tid = String(session.topic_id)
      if (lastExamByTopic.has(tid)) continue // already have the most recent (sorted desc)
      const summary = session.summary as any
      const hasFalseConf = Boolean(
        summary?.passed &&
        Array.isArray(summary?.review_concepts) &&
        summary.review_concepts.length > 0 &&
        !summary.passed, // passed but flagged — check both flags
      ) || Boolean(
        session.summary &&
        typeof session.summary === 'object' &&
        (session.summary as any).false_confidence,
      )
      lastExamByTopic.set(tid, {
        completedAt: session.completed_at instanceof Date ? session.completed_at : new Date(session.completed_at ?? 0),
        falseConfidence: hasFalseConf,
      })
    }

    const doubtCountByTopic = new Map<string, number>()
    for (const row of doubtAgg) {
      doubtCountByTopic.set(String(row._id), Number(row.count ?? 0))
    }

    // Per-topic recall-break performance (strengthens nodes in the personal graph)
    const recallStatsByTopic = new Map<string, RawRecallStats>()
    for (const t of topics) {
      const stats = (t as any).recall_stats
      if (stats && Number(stats.attempts ?? 0) > 0) {
        recallStatsByTopic.set(String(t._id), {
          attempts: Number(stats.attempts ?? 0),
          hits: Number(stats.hits ?? 0),
          misses: Number(stats.misses ?? 0),
        })
      }
    }

    // Recursive-spine layout needs the full containment tree. The transform also
    // reconstructs missing container metadata for older persisted courses.
    let graphTopics = normalizeGraphTopicHierarchy(topics as any)

    // ── Knowledge view: only concepts the learner has actually touched ──
    // Touched = any non-locked state (active, partial, functional, mastered,
    // unstable, done). Ancestor containers of touched leaves are kept so the
    // layout's containment tree stays intact.
    if (view === 'knowledge') {
      const touched = graphTopics.filter((t) => String(t.state ?? 'locked') !== 'locked')
      const keep = new Set<string>(touched.map((t) => String(t._id)))
      const byId = new Map(graphTopics.map((t) => [String(t._id), t]))
      for (const t of touched) {
        const pathIds: string[] = Array.isArray((t as any).path_ids) ? (t as any).path_ids.map(String) : []
        for (const ancestorId of pathIds) {
          if (byId.has(ancestorId)) keep.add(ancestorId)
        }
        let parentId = t.parent_id ? String(t.parent_id) : null
        while (parentId && byId.has(parentId) && !keep.has(parentId)) {
          keep.add(parentId)
          const parent = byId.get(parentId)
          parentId = parent?.parent_id ? String(parent.parent_id) : null
        }
      }
      graphTopics = graphTopics.filter((t) => keep.has(String(t._id)))
      // Containers whose children were all filtered out shouldn't render as
      // boxes with phantom counts — recompute hierarchy metadata on the subset.
      graphTopics = normalizeGraphTopicHierarchy(graphTopics)
    }

    const graphTopicIds = new Set(graphTopics.map((topic) => String(topic._id)))
    // Only pass through known visual edge types — drops legacy hierarchy edges and any
    // unknown types. Both endpoints must be topics that exist in the graph.
    const GRAPH_EDGE_TYPES = new Set(['sequence', 'prerequisite', 'recommended', 'semantic'])
    const graphEdges = topicEdges.filter((edge) => {
      if (!GRAPH_EDGE_TYPES.has(String(edge.edge_type ?? 'semantic'))) return false
      const isLegacyManufacturedSequence =
        String(edge.edge_type) === 'sequence'
        && String(course.mode ?? '') !== 'source_grounded'
        && /^Study ".+" before ".+"\.$/.test(String(edge.reason ?? ''))
      if (isLegacyManufacturedSequence) return false
      return graphTopicIds.has(String(edge.from_topic_id)) && graphTopicIds.has(String(edge.to_topic_id))
    })

    // User connections whose endpoints exist in the current view
    const visibleConnections = userConnections.filter(
      (conn) => graphTopicIds.has(String(conn.from_topic_id)) && graphTopicIds.has(String(conn.to_topic_id)),
    )

    // Find the topic the user is currently studying (first active teachable leaf)
    const activeTopic = graphTopics.find(
      (t) => t.state === 'active' && String(t.node_type ?? '') !== 'container',
    )
    const activeSingleTopicId = activeTopic ? String(activeTopic._id) : null

    // Knowledge view: hide branches the learner hasn't entered yet.
    const visibleBranchKeys = new Set(graphTopics.map((t) => String(t.branch_id)))
    const visibleBranches = view === 'knowledge'
      ? branches.filter((b) => visibleBranchKeys.has(String((b as any).branch_key ?? b._id)))
      : branches

    const graphData = transformToGraphData({
      courseId,
      courseTitle: course.title ?? course.topic ?? 'Untitled',
      topics: graphTopics as any,
      branches: visibleBranches as any,
      topicEdges: graphEdges as any,
      activeSingleTopicId,
      lastExamByTopic,
      doubtCountByTopic,
      userConnections: visibleConnections as any,
      recallStatsByTopic,
    })

    // Merge graph-manager confidence + review states onto nodes
    const nodeMeta = new Map<string, { confidenceScore: number; reviewState: string }>()
    for (const meta of graphNodeMeta) {
      nodeMeta.set(String(meta.topic_id), {
        confidenceScore: Number(meta.confidence_score ?? 50),
        reviewState: String(meta.review_state ?? 'inferred'),
      })
    }
    if (nodeMeta.size > 0) {
      for (const node of graphData.nodes) {
        const meta = nodeMeta.get(node.id)
        if (meta) {
          node.confidenceScore = meta.confidenceScore
          node.reviewState = meta.reviewState as any
        }
      }
    }

    return {
      ...graphData,
      view,
      // Total concepts in the full course — lets the knowledge view show
      // "12 of 64 concepts on your map" without a second request.
      fullTopicCount: topics.filter((t) => {
        const nodeType = String((t as any).node_type ?? 'learning_unit')
        const childCount = Number((t as any).children_count ?? 0)
        return nodeType !== 'container' && childCount <= 0
      }).length,
    }
    })

    return NextResponse.json(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    const status = message.includes('sign in') ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
