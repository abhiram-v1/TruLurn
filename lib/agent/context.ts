import type { Db } from 'mongodb'
import {
  buildAppKnowledgeContext,
  shouldRetrieveAppKnowledge,
} from '@/lib/agent/appKnowledge'

type HistoryMessage = {
  role: 'user' | 'assistant'
  content: string
  topic_title?: string | null
  page_number?: number | null
  global_page_number?: number | null
}

export type AgentContextPlan = {
  needsAtlas: boolean
  needsGraph: boolean
  needsQuiz: boolean
  needsSemanticMemory: boolean
  needsAppKnowledge: boolean
  reason: string
}

const ATLAS_SIGNALS = [
  'atlas',
  'roadmap',
  'traccia',
  'path',
  'course structure',
  'curriculum',
  'branch',
  'module',
  'next topic',
  'previous topic',
  'prerequisite',
  'unlock',
  'locked',
  'where am i',
  'what should i study',
]

const GRAPH_SIGNALS = [
  'graph',
  'connection',
  'connected',
  'edge',
  'node',
  'relationship',
  'depends on',
  'dependency',
  'weak connection',
  'strong connection',
  'learning signal',
  'progress',
  'mastery',
  'understood',
  'misconception',
  'suggested',
]

const QUIZ_SIGNALS = [
  'quiz',
  'test',
  'score',
  'attempt',
  'passed',
  'failed',
  'retake',
  'question',
  'practice',
]

const MEMORY_SIGNALS = [
  'earlier',
  'before',
  'previously',
  'we covered',
  'you said',
  'compare',
  'connect',
  'related',
  'difference',
  'same as',
  'remind me',
  'page number',
  'course page',
  'global page',
]

function hasAny(text: string, signals: string[]) {
  return signals.some((signal) => text.includes(signal))
}

export function estimateTokens(text: string) {
  return Math.ceil(text.length / 4)
}

export function planAgentContext(message: string, selectedContext?: string | null): AgentContextPlan {
  const q = `${message}\n${selectedContext ?? ''}`.toLowerCase()
  const needsAtlas = hasAny(q, ATLAS_SIGNALS)
  const needsGraph = hasAny(q, GRAPH_SIGNALS)
  const needsQuiz = hasAny(q, QUIZ_SIGNALS)
  const needsAppKnowledge = shouldRetrieveAppKnowledge(q)
  const referencesPageNumber = /\bpage\s+(?:number\s*)?\d{1,4}\b/.test(q)
  const needsSemanticMemory = hasAny(q, MEMORY_SIGNALS) || needsGraph || needsAtlas || referencesPageNumber

  const requested = [
    needsAtlas ? 'Atlas' : null,
    needsGraph ? 'Graph' : null,
    needsQuiz ? 'quiz' : null,
    needsSemanticMemory ? 'semantic memory' : null,
    needsAppKnowledge ? 'product knowledge' : null,
  ].filter(Boolean)

  return {
    needsAtlas,
    needsGraph,
    needsQuiz,
    needsSemanticMemory,
    needsAppKnowledge,
    reason: requested.length ? `Detected request for ${requested.join(', ')} context.` : 'Current page context is enough.',
  }
}

export function selectAdaptiveHistory(messages: HistoryMessage[], tokenBudget = 1600) {
  const selected: HistoryMessage[] = []
  let used = 0

  for (const message of [...messages].reverse()) {
    const cost = estimateTokens([
      message.role,
      message.topic_title ?? '',
      String(message.page_number ?? ''),
      String(message.global_page_number ?? ''),
      message.content,
    ].join('\n'))

    if (selected.length > 0 && used + cost > tokenBudget) break
    selected.push(message)
    used += cost
  }

  return {
    messages: selected.reverse(),
    tokenEstimate: used,
    dropped: Math.max(0, messages.length - selected.length),
  }
}

function compact(text: string, max = 360) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}...` : clean
}

function stateLabel(state: unknown) {
  const value = String(state ?? 'locked')
  if (value === 'mastered' || value === 'done') return 'settled'
  if (value === 'functional') return 'usable'
  if (value === 'partial') return 'developing'
  if (value === 'unstable') return 'needs review'
  if (value === 'active') return 'active'
  return 'locked'
}

function formatAtlas({
  branches,
  topics,
  currentTopicId,
}: {
  branches: any[]
  topics: any[]
  currentTopicId: string
}) {
  const branchKey = (branch: any) => String(branch.branch_key ?? branch._id)
  const lines: string[] = ['ATLAS STRUCTURE:']

  for (const branch of branches.slice(0, 14)) {
    const key = branchKey(branch)
    const branchTopics = topics
      .filter((topic) => String(topic.branch_id) === key || String(topic.branch_id) === String(branch._id))
      .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))

    lines.push(`- ${branch.title}: ${compact(String(branch.description ?? ''), 180)}`)
    for (const topic of branchTopics.slice(0, 16)) {
      const id = String(topic._id)
      const marker = id === currentTopicId ? ' [CURRENT]' : ''
      const prereqs = Array.isArray(topic.prerequisites) && topic.prerequisites.length
        ? `; prerequisites: ${topic.prerequisites.length}`
        : ''
      lines.push(`  - ${topic.title}${marker} (${stateLabel(topic.state)}${prereqs})`)
    }
  }

  return lines.join('\n')
}

function formatGraph({
  topics,
  edges,
  currentTopicId,
}: {
  topics: any[]
  edges: any[]
  currentTopicId: string
}) {
  const topicById = new Map(topics.map((topic) => [String(topic._id), topic]))
  const current = topicById.get(currentTopicId)
  const nearEdges = edges.filter((edge) =>
    String(edge.from_topic_id) === currentTopicId || String(edge.to_topic_id) === currentTopicId,
  )
  const suggested = topics.filter((topic) => Boolean(topic.suggested)).slice(0, 5)
  const review = topics.filter((topic) => ['unstable', 'partial'].includes(String(topic.state))).slice(0, 8)

  const lines = ['GRAPH SIGNALS:']
  if (current) {
    lines.push(`Current node: ${current.title} (${stateLabel(current.state)})`)
    const prereqs = Array.isArray(current.prerequisites)
      ? current.prerequisites.map((id: string) => topicById.get(String(id))?.title).filter(Boolean)
      : []
    if (prereqs.length) lines.push(`Prerequisites for current node: ${prereqs.join(', ')}`)
  }

  if (nearEdges.length) {
    lines.push('Nearby concept links:')
    for (const edge of nearEdges.slice(0, 10)) {
      const from = topicById.get(String(edge.from_topic_id))?.title ?? edge.from_topic_id
      const to = topicById.get(String(edge.to_topic_id))?.title ?? edge.to_topic_id
      const strength = edge.strength ? ` (${edge.strength})` : ''
      lines.push(`- ${from} -> ${to}${strength}${edge.reason ? `: ${compact(String(edge.reason), 140)}` : ''}`)
    }
  }

  if (suggested.length) {
    lines.push(`Suggested next concepts: ${suggested.map((topic) => topic.title).join(', ')}`)
  }

  if (review.length) {
    lines.push(`Concepts to revisit gently: ${review.map((topic) => `${topic.title} (${stateLabel(topic.state)})`).join(', ')}`)
  }

  return lines.join('\n')
}

function formatQuizSignals(attempts: any[], examSessions: any[], topics: any[]) {
  const topicById = new Map(topics.map((topic) => [String(topic._id), topic.title]))
  if (!attempts.length && !examSessions.length) return 'QUIZ SIGNALS:\nNo quiz attempts stored yet.'

  const lines = ['QUIZ SIGNALS:']
  for (const session of examSessions.slice(0, 8)) {
    const topic = topicById.get(String(session.topic_id)) ?? 'Topic'
    const summary = session.summary && typeof session.summary === 'object' ? session.summary : null
    const result = summary?.passed ? 'completed' : 'review suggested'
    const review = Array.isArray(summary?.review_concepts) && summary.review_concepts.length
      ? `; review: ${summary.review_concepts.slice(0, 3).join(', ')}`
      : ''
    const strong = Array.isArray(summary?.strong_concepts) && summary.strong_concepts.length
      ? `; steady: ${summary.strong_concepts.slice(0, 3).join(', ')}`
      : ''
    lines.push(`- ${topic}: ${result}${review}${strong}`)
  }

  for (const attempt of attempts.slice(0, 8)) {
    const topic = topicById.get(String(attempt.topic_id)) ?? 'Topic'
    const result = attempt.passed ? 'completed' : 'needs review'
    const gaps = attempt.evaluation && typeof attempt.evaluation === 'object'
      ? Object.values(attempt.evaluation as Record<string, any>)
          .map((item: any) => item?.gap)
          .filter(Boolean)
          .slice(0, 2)
      : []
    lines.push(`- ${topic}: ${result}${gaps.length ? `; gaps: ${gaps.join('; ')}` : ''}`)
  }
  return lines.join('\n')
}

export async function buildAgentWorkspaceContext({
  db,
  courseId,
  userId,
  currentTopicId,
  plan,
  query,
}: {
  db: Db
  courseId: string
  userId: string
  currentTopicId: string
  plan: AgentContextPlan
  query: string
}) {
  const appKnowledgePromise = plan.needsAppKnowledge
    ? buildAppKnowledgeContext({ db, userId, courseId, query })
    : Promise.resolve('')

  if (!plan.needsAtlas && !plan.needsGraph && !plan.needsQuiz) {
    return appKnowledgePromise
  }

  const appKnowledge = await appKnowledgePromise

  const [course, branches, topics, edges, attempts, examSessions] = await Promise.all([
    db.collection('courses').findOne({ _id: courseId as any, user_id: userId }),
    db.collection('branches').find({ course_id: courseId }).sort({ created_at: 1 }).toArray(),
    db.collection('topics').find({ course_id: courseId }).sort({ branch_position: 1, branch_id: 1, position: 1 }).toArray(),
    plan.needsGraph
      ? db.collection('topicEdges').find({ course_id: courseId }).toArray()
      : Promise.resolve([]),
    plan.needsQuiz
      ? db.collection('quizAttempts').find({ course_id: courseId, user_id: userId }).sort({ created_at: -1 }).limit(12).toArray()
      : Promise.resolve([]),
    plan.needsQuiz
      ? db.collection('examSessions').find({ course_id: courseId, user_id: userId, status: 'completed' }).sort({ completed_at: -1 }).limit(12).toArray()
      : Promise.resolve([]),
  ])

  if (!course) return ''

  const blocks = [`AGENT WORKSPACE CONTEXT:\nCourse: ${course.title ?? course.topic ?? 'Untitled course'}\nContext plan: ${plan.reason}`]

  if (plan.needsAtlas) {
    blocks.push(formatAtlas({ branches, topics, currentTopicId }))
  }

  if (plan.needsGraph) {
    blocks.push(formatGraph({ topics, edges, currentTopicId }))
  }

  if (plan.needsQuiz) {
    blocks.push(formatQuizSignals(attempts, examSessions, topics))
  }

  if (appKnowledge) {
    blocks.push(appKnowledge)
  }

  return blocks.join('\n\n')
}
