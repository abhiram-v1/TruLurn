import crypto from 'crypto'
import type { Db } from 'mongodb'
import type { EvaluationResult, ExamMode, ExamTurnSource, QuestionType } from '@/types'
import { generateWithGemini } from '@/lib/ai/gemini/client'
import { parseGeminiJson } from '@/lib/ai/gemini/json'
import { isContainerTopic, sortTracciaTopics } from '@/lib/traccia/sequence'
import { unlockNextTopics } from '@/lib/db-helpers'
import { evaluateQuizForGraph } from '@/lib/ai/graphEvaluator'

const FULL_TOPIC_MIN_BASELINE = 5
const FULL_TOPIC_HARD_MAX = 8
const FULL_TOPIC_MAX_FOLLOWUPS = 2
const SPOT_CHECK_MAX = 3

type TopicDoc = { _id: unknown } & Record<string, any>
type CourseDoc = { _id: unknown } & Record<string, any>

type QuizTarget = {
  nodeId: string
  nodeTitle: string
  concept: string
  depthLevel: number
  pathTitles: string[]
  pageNumbers: number[]
  summary: string
  prerequisiteTitles: string[]
}

type Blueprint = {
  course: CourseDoc
  topic: TopicDoc
  branchTitle: string
  targets: QuizTarget[]
  priorEvidence: string
  isProgramming: boolean
}

function compact(value: unknown, max = 520) {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}...` : clean
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function idOf(doc: any) {
  return String(doc?._id ?? doc?.id ?? '')
}

function isProgrammingContext(course: any, topic: any, text: string) {
  return [
    course?.title,
    course?.topic,
    course?.goals,
    topic?.title,
    topic?.description,
    topic?.summary,
    text.slice(0, 5000),
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase()
    .match(/\b(code|coding|programming|function|class|method|variable|algorithm|data structure|debug|syntax|python|javascript|typescript|java|c\+\+|c#|react|node|sql|html|css|api|compiler|runtime)\b/) != null
}

function normalizeQuestionType(value: unknown, fallback: QuestionType): QuestionType {
  const type = String(value ?? fallback)
  return ['apply', 'spot_error', 'explain', 'mcq', 'true_false', 'code'].includes(type)
    ? type as QuestionType
    : fallback
}

function chooseType(target: QuizTarget, index: number, source: ExamTurnSource, isProgramming: boolean): QuestionType {
  if (isProgramming && index % 5 === 4) return 'code'
  if (source === 'followup') {
    if (target.depthLevel >= 4) return index % 2 === 0 ? 'spot_error' : 'apply'
    return index % 2 === 0 ? 'apply' : 'explain'
  }
  if (target.depthLevel >= 4) return ['apply', 'spot_error', 'apply', 'mcq'][index % 4] as QuestionType
  if (target.depthLevel >= 3) return ['explain', 'apply', 'spot_error', 'mcq'][index % 4] as QuestionType
  return ['explain', 'mcq', 'true_false', 'apply'][index % 4] as QuestionType
}

function difficultyFor(target: QuizTarget, source: ExamTurnSource, recentFailures: number) {
  const base = clamp(target.depthLevel || 2, 1, 4)
  const modifier = source === 'followup' ? 1 : recentFailures >= 2 ? -1 : 0
  return clamp(base + modifier, 1, 5)
}

function targetKey(target: QuizTarget) {
  return `${target.nodeId}:${target.concept.toLowerCase()}`
}

function serializeTurn(turn: any) {
  if (!turn) return null
  return {
    id: String(turn._id),
    session_id: String(turn.session_id),
    course_id: String(turn.course_id),
    topic_id: String(turn.topic_id),
    turn_index: Number(turn.turn_index ?? 1),
    roadmap_node_id: String(turn.roadmap_node_id ?? turn.topic_id),
    concept: String(turn.concept ?? ''),
    type: normalizeQuestionType(turn.type, 'explain'),
    difficulty: Number(turn.difficulty ?? 2),
    source: String(turn.source ?? 'baseline') as ExamTurnSource,
    status: String(turn.status ?? 'shown'),
    question: String(turn.question ?? ''),
    options: Array.isArray(turn.options) ? turn.options.map(String) : null,
    created_at: turn.created_at instanceof Date ? turn.created_at.toISOString() : new Date().toISOString(),
  }
}

export function serializeExamSession(session: any, turn: any) {
  return {
    session: {
      id: String(session._id),
      course_id: String(session.course_id),
      topic_id: String(session.topic_id),
      mode: String(session.mode ?? 'full_topic') as ExamMode,
      status: String(session.status ?? 'active'),
      question_index: Number(session.question_index ?? 0),
      min_questions: Number(session.min_questions ?? FULL_TOPIC_MIN_BASELINE),
      max_questions: Number(session.max_questions ?? FULL_TOPIC_HARD_MAX),
      followups_used: Number(session.followups_used ?? 0),
      max_followups: Number(session.max_followups ?? FULL_TOPIC_MAX_FOLLOWUPS),
      summary: session.summary ?? null,
    },
    turn: serializeTurn(turn),
  }
}

async function buildBlueprint(db: Db, course: CourseDoc, topic: TopicDoc, userId: string): Promise<Blueprint> {
  const courseId = String(course._id)
  const topicId = String(topic._id)
  const allTopics = await db.collection('topics')
    .find({ course_id: courseId })
    .project({
      title: 1,
      parent_id: 1,
      path_ids: 1,
      path_titles: 1,
      branch_id: 1,
      section: 1,
      node_type: 1,
      children_count: 1,
      depth_level: 1,
      learning_depth: 1,
      position: 1,
      sequence_index: 1,
      prerequisites: 1,
      state: 1,
      summary: 1,
      description: 1,
    })
    .toArray()

  const orderedTopics = sortTracciaTopics(allTopics as any[])
  const focusTopics = isContainerTopic(topic)
    ? orderedTopics.filter((candidate: any) => {
        const pathIds = (candidate.path_ids ?? []).map(String)
        return pathIds.includes(topicId) && String(candidate._id) !== topicId && !isContainerTopic(candidate)
      })
    : [topic]

  const focusIds = focusTopics.length ? focusTopics.map((item: any) => String(item._id)) : [topicId]
  const [branch, pages, pageSummaries, oldAttempts, recentSessions] = await Promise.all([
    db.collection('branches').findOne({
      course_id: courseId,
      $or: [{ _id: topic.branch_id as any }, { branch_key: topic.branch_id }],
    }),
    db.collection('pages')
      .find({ course_id: courseId, topic_id: { $in: focusIds } })
      .sort({ topic_id: 1, page_number: 1 })
      .toArray(),
    db.collection('pageSummaries')
      .find({ course_id: courseId, topic_id: { $in: focusIds } })
      .sort({ topic_id: 1, page_number: 1 })
      .toArray(),
    db.collection('quizAttempts')
      .find({ course_id: courseId, topic_id: topicId, user_id: userId })
      .sort({ created_at: -1 })
      .limit(3)
      .toArray(),
    db.collection('examSessions')
      .find({ course_id: courseId, topic_id: topicId, user_id: userId, status: 'completed' })
      .sort({ completed_at: -1 })
      .limit(3)
      .toArray(),
  ])

  const prereqIds = Array.from(new Set(focusTopics.flatMap((item: any) => (item.prerequisites ?? []).map(String))))
  const prerequisites = prereqIds.length
    ? await db.collection('topics').find({ course_id: courseId, _id: { $in: prereqIds as any[] } }).project({ title: 1 }).toArray()
    : []
  const prereqTitleById = new Map(prerequisites.map((item: any) => [String(item._id), String(item.title ?? '')]))

  const summariesByTopic = new Map<string, any[]>()
  for (const summary of pageSummaries) {
    const key = String(summary.topic_id)
    summariesByTopic.set(key, [...(summariesByTopic.get(key) ?? []), summary])
  }

  const pagesByTopic = new Map<string, any[]>()
  for (const page of pages) {
    const key = String(page.topic_id)
    pagesByTopic.set(key, [...(pagesByTopic.get(key) ?? []), page])
  }

  const targets: QuizTarget[] = []
  for (const node of focusTopics) {
    const nodeId = String(node._id)
    const summaries = summariesByTopic.get(nodeId) ?? []
    const nodePages = pagesByTopic.get(nodeId) ?? []
    const keyConcepts = summaries
      .flatMap((summary: any) => Array.isArray(summary.key_concepts) ? summary.key_concepts : [])
      .map((item: any) => compact(item, 80))
      .filter(Boolean)
    const uniqueConcepts = Array.from(new Set(keyConcepts)).slice(0, 8)
    const concepts = uniqueConcepts.length ? uniqueConcepts : [String(node.title ?? topic.title)]
    const summaryText = compact([
      node.summary,
      node.description,
      ...summaries.map((summary: any) => summary.summary ?? summary.focus),
      ...nodePages.slice(0, 2).map((page: any) => page.summary ?? page.content),
    ].filter(Boolean).join(' '), 900)

    for (const concept of concepts) {
      targets.push({
        nodeId,
        nodeTitle: String(node.title ?? topic.title),
        concept,
        depthLevel: Number(node.depth_level ?? node.learning_depth ?? 2),
        pathTitles: Array.isArray(node.path_titles) && node.path_titles.length
          ? node.path_titles.map(String)
          : [String(branch?.title ?? node.section ?? course.title), String(node.title ?? topic.title)],
        pageNumbers: summaries
          .map((summary: any) => Number(summary.page_number))
          .filter((value: number) => Number.isFinite(value)),
        summary: summaryText,
        prerequisiteTitles: (node.prerequisites ?? [])
          .map((id: any) => prereqTitleById.get(String(id)))
          .filter(Boolean) as string[],
      })
    }
  }

  if (!targets.length) {
    targets.push({
      nodeId: topicId,
      nodeTitle: String(topic.title ?? 'Current topic'),
      concept: String(topic.title ?? 'Current topic'),
      depthLevel: Number(topic.depth_level ?? 2),
      pathTitles: Array.isArray(topic.path_titles) && topic.path_titles.length ? topic.path_titles.map(String) : [String(topic.title ?? 'Current topic')],
      pageNumbers: [],
      summary: compact(topic.summary ?? topic.description ?? ''),
      prerequisiteTitles: [],
    })
  }

  const priorEvidence = [
    ...oldAttempts.map((attempt: any) => {
      const passed = attempt.passed ? 'passed' : 'needs review'
      return `Old quiz attempt: ${passed}; gaps ${compact(JSON.stringify(attempt.evaluation ?? {}), 320)}`
    }),
    ...recentSessions.map((session: any) => `Recent exam: ${session.summary?.passed ? 'completed strongly' : 'review suggested'}; ${compact(session.summary?.student_summary ?? '', 240)}`),
  ].join('\n')

  return {
    course,
    topic,
    branchTitle: String(branch?.title ?? topic.section ?? course.title ?? 'Current Atlas branch'),
    targets,
    priorEvidence,
    isProgramming: isProgrammingContext(course, topic, pages.map((page: any) => page.content ?? '').join('\n')),
  }
}

async function getSessionTurns(db: Db, sessionId: string) {
  return db.collection('examTurns')
    .find({ session_id: sessionId })
    .sort({ turn_index: 1, created_at: 1 })
    .toArray()
}

function chooseTarget(blueprint: Blueprint, turns: any[], source: ExamTurnSource): QuizTarget {
  const askedKeys = new Set(turns.filter((turn) => turn.source === source || source === 'baseline').map((turn) => `${turn.roadmap_node_id}:${String(turn.concept ?? '').toLowerCase()}`))
  const failed = turns
    .filter((turn) => turn.evaluation && !turn.evaluation.passed)
    .map((turn) => ({ nodeId: String(turn.roadmap_node_id), concept: String(turn.concept ?? '') }))

  if (source === 'followup' && failed.length) {
    const latest = failed[failed.length - 1]
    return blueprint.targets.find((target) => target.nodeId === latest.nodeId && target.concept.toLowerCase() === latest.concept.toLowerCase())
      ?? blueprint.targets.find((target) => target.nodeId === latest.nodeId)
      ?? blueprint.targets[0]
  }

  return blueprint.targets.find((target) => !askedKeys.has(targetKey(target)))
    ?? blueprint.targets[turns.length % blueprint.targets.length]
    ?? blueprint.targets[0]
}

function buildPointer({
  blueprint,
  target,
  turns,
  questionType,
  difficulty,
  source,
}: {
  blueprint: Blueprint
  target: QuizTarget
  turns: any[]
  questionType: QuestionType
  difficulty: number
  source: ExamTurnSource
}) {
  const asked = turns.map((turn) => `${turn.concept} (${turn.type}, ${turn.evaluation?.passed === false ? 'gap found' : 'asked'})`).slice(-8)
  const failed = turns
    .filter((turn) => turn.evaluation && !turn.evaluation.passed)
    .map((turn) => `${turn.concept}: ${turn.evaluation.gap ?? 'unclear gap'}`)
    .slice(-4)

  return [
    'QUIZ MAP POINTER:',
    `Course: ${blueprint.course.title ?? blueprint.course.topic}`,
    `Atlas branch: ${blueprint.branchTitle}`,
    `Current Traccia path: ${target.pathTitles.join(' > ')}`,
    `Current quiz target node: ${target.nodeTitle}`,
    `Target concept: ${target.concept}`,
    `Question source: ${source}`,
    `Engine-selected type: ${questionType}`,
    `Engine-selected difficulty: ${difficulty}/5`,
    target.prerequisiteTitles.length ? `Nearby prerequisites: ${target.prerequisiteTitles.join(', ')}` : 'Nearby prerequisites: none listed',
    target.pageNumbers.length ? `Covered lesson pages: ${target.pageNumbers.join(', ')}` : 'Covered lesson pages: available lesson context only',
    target.summary ? `Covered lesson summary: ${target.summary}` : 'Covered lesson summary: none stored',
    asked.length ? `Already asked in this session: ${asked.join('; ')}` : 'Already asked in this session: none',
    failed.length ? `Failed or uncertain concepts: ${failed.join('; ')}` : 'Failed or uncertain concepts: none yet',
    blueprint.priorEvidence ? `Prior quiz evidence:\n${blueprint.priorEvidence}` : 'Prior quiz evidence: none',
  ].join('\n')
}

async function generateTurnQuestion({
  blueprint,
  target,
  turns,
  source,
}: {
  blueprint: Blueprint
  target: QuizTarget
  turns: any[]
  source: ExamTurnSource
}) {
  const recentFailures = turns.slice(-4).filter((turn) => turn.evaluation && !turn.evaluation.passed).length
  const questionType = chooseType(target, turns.length, source, blueprint.isProgramming)
  const difficulty = difficultyFor(target, source, recentFailures)
  const pointer = buildPointer({ blueprint, target, turns, questionType, difficulty, source })

  const system = `You are TruLurn's exam question writer.
The deterministic exam engine has already selected the concept, difficulty, and question type.
Your job is ONLY to write the question and grading rubric from the provided quiz pointer.

Rules:
- Do not invent concepts outside the pointer.
- Do not change the question type.
- Ground the question in the covered lesson summary and Traccia path.
- If this is a follow-up, ask from a different angle without sounding punitive.
- For critical concepts, test reasoning or transfer, not recall.
- For code questions, ask for a bounded code answer of about 8-25 lines.

Return ONLY valid JSON:
{
  "type": "${questionType}",
  "question": "...",
  "options": ["A", "B", "C", "D"] | null,
  "correct_answer": "..." | null,
  "rubric": "..."
}`

  const user = `${pointer}

Write exactly one ${questionType} question now.`

  const raw = await generateWithGemini({ system, user, purpose: 'primary', responseMimeType: 'text/plain' })
  const parsed = parseGeminiJson<any>(raw)

  const type = questionType
  const options = type === 'mcq' && Array.isArray(parsed.options)
    ? parsed.options.map(String).slice(0, 4)
    : null

  if (type === 'mcq' && (!options || options.length !== 4 || !parsed.correct_answer)) {
    throw new Error('Exam question generation returned an invalid multiple-choice question.')
  }
  if (type === 'true_false' && !String(parsed.correct_answer ?? '').trim()) {
    throw new Error('Exam question generation returned an invalid true/false question.')
  }

  return {
    type,
    difficulty,
    pointer,
    question: String(parsed.question ?? '').trim(),
    options,
    correct_answer: parsed.correct_answer == null ? null : String(parsed.correct_answer),
    rubric: parsed.rubric == null ? null : String(parsed.rubric),
  }
}

async function createTurn({
  db,
  session,
  source,
  status,
}: {
  db: Db
  session: any
  source: ExamTurnSource
  status: 'queued' | 'shown'
}) {
  const [course, topic, turns] = await Promise.all([
    db.collection('courses').findOne({ _id: session.course_id as any, user_id: session.user_id }),
    db.collection('topics').findOne({ _id: session.topic_id as any, course_id: session.course_id }),
    getSessionTurns(db, String(session._id)),
  ])
  if (!course || !topic) throw new Error('Exam course or topic was not found.')

  const blueprint = await buildBlueprint(db, course, topic, String(session.user_id))
  const target = chooseTarget(blueprint, turns, source)
  const generated = await generateTurnQuestion({ blueprint, target, turns, source })
  const now = new Date()
  const nextIndex = turns.reduce((max, turn) => Math.max(max, Number(turn.turn_index ?? 0)), 0) + 1
  const doc = {
    _id: crypto.randomUUID() as any,
    session_id: String(session._id),
    course_id: String(session.course_id),
    topic_id: String(session.topic_id),
    user_id: String(session.user_id),
    mode: String(session.mode ?? 'full_topic') as ExamMode,
    turn_index: nextIndex,
    roadmap_node_id: target.nodeId,
    roadmap_node_title: target.nodeTitle,
    concept: target.concept,
    type: generated.type,
    difficulty: generated.difficulty,
    source,
    status,
    question: generated.question,
    options: generated.options,
    correct_answer: generated.correct_answer,
    rubric: generated.rubric,
    pointer_snapshot: generated.pointer,
    created_at: now,
    updated_at: now,
  }
  await db.collection('examTurns').insertOne(doc)
  await db.collection('examSessions').updateOne(
    { _id: session._id },
    { $set: { updated_at: now }, $inc: { question_index: 1 } },
  )
  return doc
}

async function ensureInitialTurns(db: Db, session: any) {
  const turns = await getSessionTurns(db, String(session._id))
  if (turns.length > 0) {
    return turns.find((turn) => turn.status === 'shown' && !turn.answer)
      ?? turns.find((turn) => turn.status === 'queued')
      ?? turns[0]
  }

  const first = await createTurn({ db, session, source: session.mode === 'spot_check' ? 'spot_check' : 'baseline', status: 'shown' })
  if (session.mode !== 'spot_check') {
    createTurn({ db, session, source: 'baseline', status: 'queued' }).catch((error) => {
      console.warn('[examEngine] Failed to prequeue second exam question:', error)
    })
  }
  return first
}

export async function startOrResumeExam({
  db,
  courseId,
  topicId,
  userId,
  mode = 'full_topic',
}: {
  db: Db
  courseId: string
  topicId: string
  userId: string
  mode?: ExamMode
}) {
  const [course, topic] = await Promise.all([
    db.collection('courses').findOne({ _id: courseId as any, user_id: userId }),
    db.collection('topics').findOne({ _id: topicId as any, course_id: courseId }),
  ])
  if (!course) throw new Error('Course not found.')
  if (!topic) throw new Error('Topic not found.')

  let session = await db.collection('examSessions').findOne({
    course_id: courseId,
    topic_id: topicId,
    user_id: userId,
    mode,
    status: 'active',
  })

  if (!session) {
    const now = new Date()
    session = {
      _id: crypto.randomUUID() as any,
      course_id: courseId,
      topic_id: topicId,
      user_id: userId,
      mode,
      status: 'active',
      phase: 'mvp_linear',
      question_index: 0,
      min_questions: mode === 'spot_check' ? 1 : FULL_TOPIC_MIN_BASELINE,
      max_questions: mode === 'spot_check' ? SPOT_CHECK_MAX : FULL_TOPIC_HARD_MAX,
      followups_used: 0,
      max_followups: mode === 'spot_check' ? 0 : FULL_TOPIC_MAX_FOLLOWUPS,
      started_at: now,
      created_at: now,
      updated_at: now,
    }
    await db.collection('examSessions').insertOne(session)
  }

  const turn = await ensureInitialTurns(db, session)
  return serializeExamSession(session, turn)
}

export async function getExamState(db: Db, sessionId: string, userId: string) {
  const session = await db.collection('examSessions').findOne({ _id: sessionId as any, user_id: userId })
  if (!session) throw new Error('Exam session not found.')
  const turn = await db.collection('examTurns').findOne({
    session_id: sessionId,
    user_id: userId,
    status: 'shown',
    answer: { $exists: false },
  })
  return serializeExamSession(session, turn)
}

async function evaluateTurn(db: Db, session: any, turn: any): Promise<EvaluationResult> {
  if (turn.evaluation) return turn.evaluation as EvaluationResult
  const studentAnswer = String(turn.answer ?? '')

  if ((turn.type === 'mcq' || turn.type === 'true_false') && turn.correct_answer != null) {
    const isCorrect = studentAnswer.trim().toLowerCase() === String(turn.correct_answer).trim().toLowerCase()
    const evaluation: EvaluationResult = {
      level: isCorrect ? 3 : 1,
      passed: isCorrect,
      feedback: isCorrect ? 'Correct.' : 'This answer misses the target concept for this question.',
      gap: isCorrect ? null : `Review ${turn.concept}.`,
      false_confidence: false,
    }
    await db.collection('examTurns').updateOne(
      { _id: turn._id },
      { $set: { evaluation, status: 'evaluated', evaluated_at: new Date(), updated_at: new Date() } },
    )
    return evaluation
  }

  const codeRules = turn.type === 'code'
    ? `For code, evaluate behavior, edge cases, and whether the implementation demonstrates the concept. Do not require one exact solution.`
    : ''

  const system = `You are TruLurn's exam answer evaluator.
Grade strictly against the rubric and map pointer. Do not reveal hidden engine details.

Scale:
1 recognition only
2 mechanical or copied definition
3 conceptual and passing
4 transfer to a new case
5 fluent edge-case reasoning

${codeRules}

Return ONLY valid JSON:
{
  "level": 1,
  "passed": false,
  "feedback": "1-3 constructive sentences",
  "gap": "specific gap or null",
  "false_confidence": false
}`

  const user = `Pointer:
${turn.pointer_snapshot ?? ''}

Question type: ${turn.type}
Question: ${turn.question}
Rubric: ${turn.rubric || 'Evaluate mechanism-level understanding.'}
Student answer:
${turn.type === 'code' ? `\`\`\`\n${studentAnswer || '(no answer)'}\n\`\`\`` : studentAnswer || '(no answer)'}`

  const raw = await generateWithGemini({ system, user, purpose: 'agent', responseMimeType: 'text/plain' })
  const parsed = parseGeminiJson<any>(raw)
  const level = clamp(Number(parsed.level ?? 2), 1, 5) as EvaluationResult['level']
  const evaluation: EvaluationResult = {
    level,
    passed: Boolean(parsed.passed ?? level >= 3),
    feedback: String(parsed.feedback ?? 'Answer evaluated.'),
    gap: parsed.gap == null ? null : String(parsed.gap),
    false_confidence: Boolean(parsed.false_confidence ?? false),
  }
  await db.collection('examTurns').updateOne(
    { _id: turn._id },
    { $set: { evaluation, status: 'evaluated', evaluated_at: new Date(), updated_at: new Date() } },
  )
  return evaluation
}

async function maybeInsertFollowup(db: Db, session: any, evaluatedTurn: any, evaluation: EvaluationResult) {
  if (session.mode !== 'full_topic') return
  if (evaluation.passed) return
  const turns = await getSessionTurns(db, String(session._id))
  if (turns.length >= FULL_TOPIC_HARD_MAX) return
  if (Number(session.followups_used ?? 0) >= FULL_TOPIC_MAX_FOLLOWUPS) return
  if (evaluatedTurn.source === 'followup') return
  const conceptFollowupExists = turns.some((turn) =>
    turn.source === 'followup'
    && String(turn.roadmap_node_id) === String(evaluatedTurn.roadmap_node_id)
    && String(turn.concept ?? '').toLowerCase() === String(evaluatedTurn.concept ?? '').toLowerCase()
  )
  if (conceptFollowupExists) return
  if (Number(evaluatedTurn.difficulty ?? 1) < 2 && !evaluation.false_confidence) return

  const claim = await db.collection('examSessions').updateOne(
    { _id: session._id, followups_used: { $lt: FULL_TOPIC_MAX_FOLLOWUPS } },
    { $inc: { followups_used: 1 }, $set: { updated_at: new Date() } },
  )
  if (claim.matchedCount === 0) return
  const freshSession = await db.collection('examSessions').findOne({ _id: session._id })
  await createTurn({ db, session: freshSession ?? session, source: 'followup', status: 'queued' })
}

async function topUpQueue(db: Db, sessionId: string) {
  const session = await db.collection('examSessions').findOne({ _id: sessionId as any, status: 'active' })
  if (!session) return
  const turns = await getSessionTurns(db, sessionId)
  const queuedCount = turns.filter((turn) => turn.status === 'queued').length
  const total = turns.length
  const minQuestions = Number(session.min_questions ?? FULL_TOPIC_MIN_BASELINE)
  const maxQuestions = Number(session.max_questions ?? FULL_TOPIC_HARD_MAX)
  if (queuedCount > 0 || total >= minQuestions || total >= maxQuestions) return
  await createTurn({ db, session, source: session.mode === 'spot_check' ? 'spot_check' : 'baseline', status: 'queued' })
}

async function processAnsweredTurn(db: Db, sessionId: string, turnId: string) {
  const [session, turn] = await Promise.all([
    db.collection('examSessions').findOne({ _id: sessionId as any, status: 'active' }),
    db.collection('examTurns').findOne({ _id: turnId as any, session_id: sessionId }),
  ])
  if (!session || !turn || turn.evaluation || turn.answer == null) return
  const evaluation = await evaluateTurn(db, session, turn)
  await maybeInsertFollowup(db, session, turn, evaluation)
  await topUpQueue(db, sessionId)
}

async function finalizeExam(db: Db, session: any) {
  const turns = await getSessionTurns(db, String(session._id))
  for (const turn of turns) {
    if (turn.answer != null && !turn.evaluation) {
      await evaluateTurn(db, session, turn)
    }
  }
  const evaluatedTurns = await getSessionTurns(db, String(session._id))
  const evaluations = evaluatedTurns
    .filter((turn) => turn.evaluation)
    .map((turn) => ({ turn, evaluation: turn.evaluation as EvaluationResult }))
  const passedCount = evaluations.filter((item) => item.evaluation.passed).length
  const total = evaluations.length || 1
  const levels = evaluations.map((item) => Number(item.evaluation.level ?? 2))
  const overallLevel = clamp(Math.round(levels.reduce((sum, level) => sum + level, 0) / Math.max(1, levels.length)), 1, 5)
  const passed = passedCount / total >= 0.7 && !evaluations.some((item) => item.evaluation.false_confidence)
  const weakGaps = evaluations
    .filter((item) => !item.evaluation.passed && item.evaluation.gap)
    .map((item) => String(item.evaluation.gap))
  const strongConcepts = evaluations
    .filter((item) => item.evaluation.passed)
    .map((item) => String(item.turn.concept))
    .slice(0, 5)
  const reviewConcepts = evaluations
    .filter((item) => !item.evaluation.passed)
    .map((item) => String(item.turn.concept))
    .slice(0, 5)

  let graphUpdate = null
  if (session.mode === 'full_topic') {
    await db.collection('quizAttempts').insertOne({
      _id: crypto.randomUUID() as any,
      course_id: String(session.course_id),
      topic_id: String(session.topic_id),
      user_id: String(session.user_id),
      questions_asked: evaluatedTurns.map((turn) => String(turn._id)),
      answers: Object.fromEntries(evaluatedTurns.map((turn) => [String(turn._id), String(turn.answer ?? '')])),
      evaluation: Object.fromEntries(evaluations.map((item) => [String(item.turn._id), item.evaluation])),
      overall_level: overallLevel,
      passed,
      created_at: new Date(),
    })

    if (passed) {
      await unlockNextTopics(String(session.course_id), String(session.topic_id))
    }

    try {
      const [topic, allTopics] = await Promise.all([
        db.collection('topics').findOne({ _id: session.topic_id as any, course_id: session.course_id }),
        db.collection('topics').find({ course_id: session.course_id }).toArray(),
      ])
      if (topic) {
        const snapshot = allTopics.map((item: any) => ({
          id: String(item._id),
          title: String(item.title ?? ''),
          state: String(item.state ?? 'active'),
          mastery: item.understanding_level ? Number(item.understanding_level) * 20 : 0,
          prerequisites: (item.prerequisites ?? []).map(String),
        }))
        graphUpdate = await evaluateQuizForGraph({
          topicId: String(session.topic_id),
          topicTitle: String(topic.title ?? 'Current topic'),
          passed,
          overallLevel,
          hasFalseConfidence: evaluations.some((item) => item.evaluation.false_confidence),
          questionsCount: evaluations.length,
          weakGaps,
        }, snapshot)

        for (const update of graphUpdate.updates) {
          const $set: Record<string, unknown> = { updated_at: new Date() }
          if (update.state !== undefined) $set.state = update.state
          if (update.mastery !== undefined) $set.understanding_level = Math.round(update.mastery / 20)
          if (update.misconception !== undefined) $set.misconception = update.misconception
          if (update.suggested !== undefined) $set.suggested = update.suggested
          await db.collection('topics').updateOne({ _id: update.topicId as any, course_id: session.course_id }, { $set })
        }
        for (const unlockId of graphUpdate.unlocked) {
          await db.collection('topics').updateOne(
            { _id: unlockId as any, course_id: session.course_id, state: 'locked' },
            { $set: { state: 'active', updated_at: new Date() } },
          )
        }
      }
    } catch (error) {
      console.warn('[examEngine] Graph update failed:', error)
    }
  }

  const summary = {
    passed,
    overall_level: overallLevel,
    passed_count: passedCount,
    total_questions: evaluations.length,
    strong_concepts: Array.from(new Set(strongConcepts)),
    review_concepts: Array.from(new Set(reviewConcepts)),
    student_summary: passed
      ? 'Your answers show enough understanding to move forward. Review the notes below if you want to strengthen the details.'
      : 'This quiz found a few concepts worth revisiting before treating the topic as settled.',
    graph_update: graphUpdate
      ? { summary: graphUpdate.summary, nextSuggestedTopicId: graphUpdate.nextSuggestedTopicId }
      : null,
  }

  await db.collection('examSessions').updateOne(
    { _id: session._id },
    { $set: { status: 'completed', summary, completed_at: new Date(), updated_at: new Date() } },
  )
  return {
    ...serializeExamSession({ ...session, status: 'completed', summary }, null),
    turns: evaluatedTurns.map((turn) => ({
      ...serializeTurn(turn),
      answer: turn.answer ?? '',
      evaluation: turn.evaluation ?? null,
      rubric: turn.rubric ?? null,
    })),
  }
}

export async function answerExamTurn({
  db,
  sessionId,
  turnId,
  answer,
  userId,
}: {
  db: Db
  sessionId: string
  turnId: string
  answer: string
  userId: string
}) {
  const session = await db.collection('examSessions').findOne({ _id: sessionId as any, user_id: userId, status: 'active' })
  if (!session) throw new Error('Active exam session not found.')
  const turn = await db.collection('examTurns').findOne({ _id: turnId as any, session_id: sessionId, user_id: userId })
  if (!turn) throw new Error('Exam question not found.')
  if (turn.answer != null) throw new Error('This question has already been answered.')

  await db.collection('examTurns').updateOne(
    { _id: turn._id },
    { $set: { answer: String(answer ?? ''), status: 'answered', answered_at: new Date(), updated_at: new Date() } },
  )

  const queued = await db.collection('examTurns')
    .find({ session_id: sessionId, user_id: userId, status: 'queued' })
    .sort({ turn_index: 1 })
    .limit(1)
    .next()

  if (queued) {
    await db.collection('examTurns').updateOne(
      { _id: queued._id },
      { $set: { status: 'shown', shown_at: new Date(), updated_at: new Date() } },
    )
    processAnsweredTurn(db, sessionId, turnId).catch((error) => {
      console.warn('[examEngine] Background evaluation failed:', error)
    })
    return serializeExamSession(session, { ...queued, status: 'shown' })
  }

  await processAnsweredTurn(db, sessionId, turnId)
  const freshSession = await db.collection('examSessions').findOne({ _id: session._id })
  const turns = await getSessionTurns(db, sessionId)
  const answeredCount = turns.filter((item) => item.answer != null).length
  const maxQuestions = Number(freshSession?.max_questions ?? FULL_TOPIC_HARD_MAX)
  const minQuestions = Number(freshSession?.min_questions ?? FULL_TOPIC_MIN_BASELINE)
  const shouldComplete = answeredCount >= maxQuestions
    || (answeredCount >= minQuestions && turns.every((item) => item.status !== 'queued' && item.answer != null))

  if (freshSession && shouldComplete) {
    return finalizeExam(db, freshSession)
  }

  const queuedAfterEvaluation = await db.collection('examTurns')
    .find({ session_id: sessionId, user_id: userId, status: 'queued' })
    .sort({ turn_index: 1 })
    .limit(1)
    .next()

  if (queuedAfterEvaluation) {
    await db.collection('examTurns').updateOne(
      { _id: queuedAfterEvaluation._id },
      { $set: { status: 'shown', shown_at: new Date(), updated_at: new Date() } },
    )
    return serializeExamSession(freshSession ?? session, { ...queuedAfterEvaluation, status: 'shown' })
  }

  const next = await createTurn({
    db,
    session: freshSession ?? session,
    source: session.mode === 'spot_check' ? 'spot_check' : 'baseline',
    status: 'shown',
  })
  return serializeExamSession(freshSession ?? session, next)
}
