import crypto from 'crypto'
import type { Db } from 'mongodb'
import type { EvaluationResult, ExamMode, ExamTurnSource, QuestionType } from '@/types'
import { generateAI, parseAIJson } from '@/lib/ai'
import { buildAudienceDirective } from '@/lib/personalization/learnerPersona'
import { isContainerTopic, sortTracciaTopics } from '@/lib/traccia/sequence'
import { unlockNextTopics } from '@/lib/db-helpers'
import { evaluateQuizForGraph } from '@/lib/ai/graphEvaluator'
import { detectPrerequisiteGap } from '@/lib/quiz/prerequisiteGaps'
import { scheduleTopicReview, cancelTopicReview, recordReviewResult } from '@/lib/review/schedule'
import { syncLearnerMemoryV2 } from '@/lib/memory/service'

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

// topic is intentionally omitted — it is used only inside buildBlueprint, never by downstream callers
type Blueprint = {
  course: CourseDoc
  branchTitle: string
  targets: QuizTarget[]
  priorEvidence: string
  isProgramming: boolean
  // Topic metadata forwarded for the quiz planner
  topicMeta: {
    title: string
    conceptKind: string   // definition | mechanism | procedure | math | comparison | pitfall
    topicDepth: string    // shallow | medium | deep
    requiresQuiz: boolean
    downstreamCount: number   // how many other topics list this as a prerequisite
  }
}

// Plan produced by the AI planner before the first question is generated.
// question_count = baseline questions; follow-ups may push total above this.
type QuizPlan = {
  question_count: number
  type_plan: QuestionType[]
  reasoning: string
}

function compact(value: unknown, max = 520) {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}...` : clean
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

// ── Quiz planner ──────────────────────────────────────────────────────────────
// The AI looks at what was actually taught and decides:
//   - how many questions the concept genuinely needs (2–8)
//   - what types of questions would best reveal real understanding
//
// This replaces every hardcoded depth-tier formula. A vocabulary definition
// might need 2 questions; backpropagation with 4 lesson pages and 8 downstream
// dependents might need 6. The AI reads the content and reasons about it.
async function planQuizSession(blueprint: Blueprint): Promise<QuizPlan> {
  const { topicMeta, targets, priorEvidence, isProgramming } = blueprint

  // Summarise what was taught — key concepts + lesson summaries across all targets
  const lessonSummary = targets
    .map((t) => {
      const parts: string[] = [`Node: ${t.nodeTitle}`]
      if (t.summary) parts.push(`Summary: ${t.summary}`)
      return parts.join('\n')
    })
    .join('\n\n')

  const allKeyConcepts = Array.from(
    new Set(targets.flatMap((t) =>
      // concept field on each target is already a deduplicated key concept string
      [t.concept].filter(Boolean),
    )),
  ).slice(0, 16)

  const availableTypes = isProgramming
    ? 'mcq, true_false, apply, spot_error, explain, code'
    : 'mcq, true_false, apply, spot_error, explain'

  const system = `You are TruLurn's quiz architect. Your job is to look at what was actually taught in a lesson and decide:
1. How many questions genuinely help reveal whether a student understood it (not more, not fewer)
2. What question types would best expose real understanding vs surface recall

This is a judgment call, not a formula. Reason about the actual concept and content.

Ask yourself:
- How many distinct things can a student misunderstand here?
- If someone skimmed the lesson but didn't really get the mechanism — what questions would catch them?
- What's the minimum set of questions that gives you real confidence in their understanding?

Question types:
- mcq: Multiple choice. Tests specific mechanism understanding; good distractors trip up partial understanding.
- true_false: Quick check on a precise definition or a common misconception.
- apply: Apply to a new scenario not in the lesson. Tests mechanism vs recall.
- spot_error: Find the mistake in an argument or code. Only possible with deep understanding.
- explain: Explain in own words. Tests ability to articulate reasoning, not just recognise it.
- code: Write code. Only for programming topics where implementation reveals understanding.

Absolute limits: question_count must be between 2 and 8 (inclusive).
Practical guidance:
- Simple definition or orientation concept → 2–3
- Standard mechanism with one key insight → 3–4
- Multi-step mechanism, procedure, or math concept → 4–5
- High-risk concept: common misconceptions, cascading prerequisites, or explicitly flagged → 5–6
- Reserve 7–8 only when the content is genuinely dense AND misunderstanding has major downstream consequences

Never pad with extra questions to seem thorough. Fewer honest questions beat many safe ones.
Never repeat the same type consecutively in type_plan.

Return ONLY valid JSON matching this exact shape:
{
  "question_count": <integer 2–8>,
  "type_plan": [<type>, <type>, ...],
  "reasoning": "<one or two sentences: what drove the count and type choices>"
}`

  const user = `Course: ${blueprint.course.title ?? blueprint.course.topic}
Topic: ${topicMeta.title}
Concept kind: ${topicMeta.conceptKind || 'unknown'}
Topic depth: ${topicMeta.topicDepth || 'medium'}
Requires assessed understanding: ${topicMeta.requiresQuiz ? 'yes — flagged by lesson page generator' : 'not explicitly flagged'}
Downstream dependents: ${topicMeta.downstreamCount} other topic(s) list this as a prerequisite
Available question types: ${availableTypes}

Key concepts taught: ${allKeyConcepts.join(', ') || 'see summaries below'}

Lesson content:
${lessonSummary || 'No lesson summaries available.'}
${priorEvidence ? `\nPrior quiz evidence:\n${priorEvidence}` : ''}`

  try {
    const raw = await generateAI({
      feature: 'exam_strategy',
      system,
      user,
      responseMimeType: 'text/plain',
      responseSchema: {
        name: 'quiz_plan',
        schema: {
          type: 'object',
          properties: {
            question_count: { type: 'number' },
            type_plan:      { type: 'array', items: { type: 'string' } },
            reasoning:      { type: 'string' },
          },
          required: ['question_count', 'type_plan', 'reasoning'],
        },
      },
    })
    const parsed = parseAIJson<any>(raw)
    const count = clamp(Math.round(Number(parsed.question_count ?? 4)), 2, 8)
    const validTypes = new Set(['mcq', 'true_false', 'apply', 'spot_error', 'explain', 'code'])
    const rawPlan: QuestionType[] = Array.isArray(parsed.type_plan)
      ? parsed.type_plan
          .map((t: unknown) => String(t).toLowerCase())
          .filter((t: string) => validTypes.has(t)) as QuestionType[]
      : []

    // Ensure the type_plan has no consecutive duplicates and matches count
    const dedupedPlan = rawPlan.reduce<QuestionType[]>((acc, t) => {
      if (acc.length === 0 || acc[acc.length - 1] !== t) acc.push(t)
      return acc
    }, [])

    // Pad or trim to match question_count
    const FALLBACK_ROTATION: QuestionType[] = isProgramming
      ? ['mcq', 'apply', 'spot_error', 'explain', 'code']
      : ['mcq', 'apply', 'spot_error', 'explain', 'true_false']
    const typePlan: QuestionType[] = Array.from({ length: count }, (_, i) =>
      dedupedPlan[i] ?? FALLBACK_ROTATION[i % FALLBACK_ROTATION.length],
    )

    return {
      question_count: count,
      type_plan: typePlan,
      reasoning: String(parsed.reasoning ?? ''),
    }
  } catch (err) {
    console.warn('[examEngine] Quiz planner failed, falling back to heuristic plan:', err)
    // Fallback: simple heuristic so a planning failure never blocks the quiz
    const kind = topicMeta.conceptKind
    const depth = topicMeta.topicDepth
    const count = kind === 'pitfall' || kind === 'math' ? 5
      : depth === 'deep' ? 5
      : depth === 'shallow' ? 3
      : 4
    const FALLBACK: QuestionType[] = isProgramming
      ? ['mcq', 'apply', 'spot_error', 'explain', 'code']
      : ['mcq', 'apply', 'spot_error', 'explain', 'true_false']
    return {
      question_count: count,
      type_plan: FALLBACK.slice(0, count),
      reasoning: 'Fallback heuristic plan (planner call failed).',
    }
  }
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

function chooseType(
  target: QuizTarget,
  turns: any[],
  source: ExamTurnSource,
  isProgramming: boolean,
  quizPlan?: QuizPlan | null,
): QuestionType {
  const lastType = turns.length ? String(turns[turns.length - 1].type) as QuestionType : null
  const baselineTurns = turns.filter((t) => t.source !== 'followup')

  // Follow-ups probe a failed concept from a new angle — never repeat the type
  // that just failed, and pick something that demands active production (explain, apply,
  // spot_error) rather than recognition (mcq, true_false).
  if (source === 'followup') {
    const candidates: QuestionType[] = target.depthLevel >= 4
      ? ['spot_error', 'apply', 'explain']
      : ['explain', 'apply', 'spot_error']
    return candidates.find((t) => t !== lastType) ?? candidates[0]
  }

  // Baseline questions: follow the AI-planned type sequence when available.
  // The plan was generated by looking at the actual lesson content, so trust it.
  if (quizPlan && quizPlan.type_plan.length > 0) {
    const idx = baselineTurns.length
    const plannedType = quizPlan.type_plan[idx]
    // If the plan gives us a valid type that isn't a consecutive repeat, use it
    if (plannedType && plannedType !== lastType) return plannedType
    // If it would repeat, pick the next non-repeating type from the plan
    const fallback = quizPlan.type_plan.find((t) => t !== lastType)
    if (fallback) return fallback
  }

  // Fallback (no plan, or plan exhausted): pick from a depth-appropriate palette,
  // preferring the least-used type that isn't a consecutive repeat.
  let palette: QuestionType[]
  if (target.depthLevel >= 4) {
    palette = isProgramming
      ? ['mcq', 'apply', 'spot_error', 'code', 'explain']
      : ['mcq', 'apply', 'spot_error', 'explain', 'true_false']
  } else if (target.depthLevel >= 3) {
    palette = isProgramming
      ? ['mcq', 'apply', 'explain', 'code', 'spot_error']
      : ['mcq', 'apply', 'explain', 'spot_error', 'true_false']
  } else {
    palette = ['mcq', 'true_false', 'explain', 'apply']
  }

  const usedCounts = new Map<QuestionType, number>()
  for (const t of turns) usedCounts.set(String(t.type) as QuestionType, (usedCounts.get(String(t.type) as QuestionType) ?? 0) + 1)

  const candidates = palette
    .filter((t) => t !== lastType)
    .sort((a, b) => (usedCounts.get(a) ?? 0) - (usedCounts.get(b) ?? 0))
  return candidates[0] ?? palette[turns.length % palette.length]
}

function difficultyFor(target: QuizTarget, source: ExamTurnSource, recentFailures: number) {
  const base = clamp(target.depthLevel || 2, 1, 4)
  const modifier = source === 'followup' ? 1 : recentFailures >= 2 ? -1 : 0
  return clamp(base + modifier, 1, 5)
}

function targetKey(target: QuizTarget) {
  return `${target.nodeId}:${target.concept.toLowerCase()}`
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 800): Promise<T> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** i))
      }
    }
  }
  throw lastError
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
      min_questions: Number(session.min_questions ?? 3),
      max_questions: Number(session.max_questions ?? 7),
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
      .project({ topic_id: 1, page_number: 1, content: 1, summary: 1, focus: 1 })
      .limit(focusIds.length * 4)
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

  const programmingCheckText = pages
    .slice(0, 3)
    .map((page: any) => page.content ?? '')
    .join('\n')

  // How many other topics list this topic as a direct prerequisite — a proxy for how
  // critical it is in the course graph. Used by the quiz planner to calibrate depth.
  const downstreamCount = allTopics.filter((candidate: any) =>
    (candidate.prerequisites ?? []).map(String).includes(topicId),
  ).length

  return {
    course,
    branchTitle: String(branch?.title ?? topic.section ?? course.title ?? 'Current Atlas branch'),
    // Cap at 24 to bound snapshot size while still providing more variety than the 10-question max
    targets: targets.slice(0, 24),
    priorEvidence,
    isProgramming: isProgrammingContext(course, topic, programmingCheckText),
    topicMeta: {
      title:          String(topic.title ?? ''),
      conceptKind:    String(topic.concept_kind ?? topic.node_type ?? ''),
      topicDepth:     String(topic.depth ?? topic.topic_depth ?? 'medium'),
      requiresQuiz:   Boolean(topic.requires_quiz),
      downstreamCount,
    },
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
  quizPlan,
}: {
  blueprint: Blueprint
  target: QuizTarget
  turns: any[]
  source: ExamTurnSource
  quizPlan?: QuizPlan | null
}) {
  const recentFailures = turns.slice(-4).filter((turn) => turn.evaluation && !turn.evaluation.passed).length
  const questionType = chooseType(target, turns, source, blueprint.isProgramming, quizPlan)
  const difficulty = difficultyFor(target, source, recentFailures)
  const pointer = buildPointer({ blueprint, target, turns, questionType, difficulty, source })

  const system = `You are TruLurn's learning checkpoint writer.
The engine has already chosen the concept, difficulty, and question type. Your only job is to write the question and describe what a genuinely clear answer looks like.

Write questions that show the learner where their understanding actually is — not to catch them out, but to give them an honest picture. The question should feel like a natural extension of the lesson, not an interrogation.

${buildAudienceDirective(blueprint.course.learner_persona, blueprint.course.goals)}
Question scenarios must come from THIS learner's world — a professional gets workplace scenarios, a hobbyist gets everyday ones, a school/university student may get classroom or exam-style ones. Never write "a student does X" framing by default.

General rules:
- Stay within the concepts in the pointer. Do not introduce ideas the lesson has not covered.
- Do not change the question type.
- If this is a follow-up, approach the same concept from a genuinely different angle — not a harder repeat of the same question.
- For critical concepts, test reasoning or application. Never ask for pure recall.
- For code questions, ask for a bounded implementation of about 8–25 lines that demonstrates the concept in action.
- The rubric should describe what a genuinely clear answer looks like, not a perfect one.

FORMATTING CODE IN QUESTIONS — follow these exactly:
- Whenever the question shows a code snippet, ALWAYS wrap it in a fenced code block with the language tag.
- Use \\n to represent newlines inside the JSON string value. Each line of code must be on its own line.
- Correct format inside the JSON "question" field:
  "question": "You write this program:\\n\\n\`\`\`python\\nprice = 8\\ntax = 2\\ntotal = price + tax\\n\`\`\`\\n\\nWhat happens when you run it?"
- NEVER write code as plain inline text like: "price = 8 tax = 2 total = price + tax"
- NEVER omit the language tag. For Python use \`\`\`python, for JavaScript use \`\`\`javascript, etc.
- Short inline references to variable names or function names use backtick inline code: \`price\`, \`print()\`.

MCQ-specific rules (apply these whenever type is "mcq"):
- Build a scenario, problem, or application question — never a definition lookup or "which term means X".
- For quantitative or mathematical concepts: give a concrete problem with four numerical or algebraic answer options.
- For conceptual topics: present a scenario or prediction, then give four interpretations — three that represent specific, plausible misconceptions a learner at this level would actually hold.
- Each wrong option must require genuine understanding to eliminate. A learner who only half-understands the concept should find at least two options plausible.
- Do not use "all of the above", "none of the above", or obviously wrong answers.
- The correct option should not stand out by length or style — all four options should look equally credible at a glance.
- The rubric should state the reasoning that leads to the correct answer, not just name it.

Return ONLY valid JSON:
{
  "type": "${questionType}",
  "question": "...",
  "options": ${questionType === 'mcq' ? '["A. ...", "B. ...", "C. ...", "D. ..."]' : 'null'},
  "correct_answer": ${questionType === 'mcq' ? '"A. ..."' : 'null'},
  "rubric": "..."
}`

  const user = `${pointer}

Write exactly one ${questionType} question now.`

  const raw = await withRetry(() =>
    generateAI({
      feature: 'exam_question_generation',
      system,
      user,
      responseMimeType: 'text/plain',
      responseSchema: {
        name: 'quiz_question',
        schema: {
          type: 'object',
          properties: {
            type:           { type: 'string' },
            question:       { type: 'string' },
            options:        { type: ['array', 'null'], items: { type: 'string' } },
            correct_answer: { type: ['string', 'null'] },
            rubric:         { type: ['string', 'null'] },
          },
          required: ['type', 'question', 'options', 'correct_answer', 'rubric'],
        },
      },
    }),
  )
  const parsed = parseAIJson<any>(raw)

  const type = questionType
  const options = type === 'mcq' && Array.isArray(parsed.options)
    ? parsed.options.map(String).slice(0, 4)
    : null

  if (!String(parsed.question ?? '').trim()) {
    throw new Error('Learning checkpoint generation returned an empty question.')
  }
  if (type === 'mcq' && (!options || options.length !== 4 || !String(parsed.correct_answer ?? '').trim())) {
    throw new Error('MCQ generation returned an incomplete question — options or correct answer missing.')
  }

  return {
    type,
    difficulty,
    pointer,
    question: String(parsed.question).trim(),
    options,
    correct_answer: type === 'mcq' ? String(parsed.correct_answer) : null,
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
  let blueprint: Blueprint
  const turns = await getSessionTurns(db, String(session._id))

  if (session.blueprint_snapshot) {
    // Use the blueprint cached at session creation — avoids 7 extra DB reads per question
    blueprint = session.blueprint_snapshot as Blueprint
  } else {
    // Fallback for sessions that predate blueprint caching
    const [course, topic] = await Promise.all([
      db.collection('courses').findOne({ _id: session.course_id as any, user_id: session.user_id }),
      db.collection('topics').findOne({ _id: session.topic_id as any, course_id: session.course_id }),
    ])
    if (!course || !topic) throw new Error('Exam course or topic was not found.')
    blueprint = await buildBlueprint(db, course, topic, String(session.user_id))
  }
  const target = chooseTarget(blueprint, turns, source)
  const quizPlan: QuizPlan | null = session.quiz_plan ?? null
  const generated = await generateTurnQuestion({ blueprint, target, turns, source, quizPlan })
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
  isReview = false,
}: {
  db: Db
  courseId: string
  topicId: string
  userId: string
  mode?: ExamMode
  isReview?: boolean
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
    is_review: isReview,
  })

  if (!session) {
    // Build blueprint once here so createTurn can reuse it without re-fetching
    const blueprint = await buildBlueprint(db, course, topic, userId)

    // For spot_check, use a fixed budget. For full_topic, let the AI plan the session
    // by reading the actual lesson content rather than applying a depth-level formula.
    const quizPlan: QuizPlan | null = mode === 'spot_check'
      ? null
      : await planQuizSession(blueprint)

    const plannedCount = quizPlan?.question_count ?? 4
    const minQ = mode === 'spot_check' ? 1 : plannedCount
    const maxQ = mode === 'spot_check' ? SPOT_CHECK_MAX : plannedCount + FULL_TOPIC_MAX_FOLLOWUPS

    const now = new Date()
    session = {
      _id: crypto.randomUUID() as any,
      course_id: courseId,
      topic_id: topicId,
      user_id: userId,
      mode,
      is_review: isReview,
      status: 'active',
      phase: 'mvp_linear',
      question_index: 0,
      min_questions: minQ,
      max_questions: maxQ,
      quiz_plan: quizPlan,
      followups_used: 0,
      max_followups: mode === 'spot_check' ? 0 : FULL_TOPIC_MAX_FOLLOWUPS,
      blueprint_snapshot: blueprint,
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
      feedback: isCorrect
        ? 'Right answer — you identified the correct option.'
        : `Not quite. Take another look at ${turn.concept} in the lesson to see where this one leads.`,
      gap: isCorrect ? null : `Revisit ${turn.concept} in the lesson materials.`,
      false_confidence: false,
    }
    await db.collection('examTurns').updateOne(
      { _id: turn._id },
      { $set: { evaluation, status: 'evaluated', evaluated_at: new Date(), updated_at: new Date() } },
    )
    return evaluation
  }

  const codeRules = turn.type === 'code'
    ? `For code: focus on whether the implementation demonstrates understanding of the concept. Do not penalise style, naming, or minor syntax issues that don't affect the core logic.`
    : ''

  const system = `You are TruLurn's learning feedback writer. A student has answered a question and you need to give them honest, useful feedback on where their understanding is right now.

Your goal is not to judge — it is to give the student a clear, kind picture of where they stand and what, if anything, would deepen their understanding.

Always acknowledge what is working before describing what is missing. Be honest but not harsh. The student should finish reading your feedback knowing exactly what they understood and what their next step is.

Understanding levels — use these to describe where the student currently is, not to assign a grade:
1 — they have encountered the idea but cannot yet explain it in their own words
2 — they can describe it or follow a procedure, but the underlying reason is not yet clear
3 — they understand why it works, not just how — this is enough to move forward
4 — they can apply the reasoning to situations they have not seen before
5 — they understand it intuitively and can reason about edge cases without hesitation

${codeRules}

Return ONLY valid JSON:
{
  "level": 3,
  "passed": true,
  "feedback": "2-3 sentences: start with what they showed, then describe what would deepen it or what is missing",
  "gap": "the specific concept or reasoning step worth revisiting, or null if level is 3 or above",
  "false_confidence": false
}`

  const user = `Pointer:
${turn.pointer_snapshot ?? ''}

Question type: ${turn.type}
Question: ${turn.question}
Rubric: ${turn.rubric || 'Evaluate mechanism-level understanding.'}
Student answer:
${turn.type === 'code' ? `\`\`\`\n${studentAnswer || '(no answer)'}\n\`\`\`` : studentAnswer || '(no answer)'}`

  const raw = await withRetry(() =>
    generateAI({
      feature: 'exam_evaluation',
      system,
      user,
      responseMimeType: 'text/plain',
      responseSchema: {
        name: 'quiz_evaluation',
        schema: {
          type: 'object',
          properties: {
            level:           { type: 'number' },
            passed:          { type: 'boolean' },
            feedback:        { type: 'string' },
            gap:             { type: ['string', 'null'] },
            false_confidence:{ type: 'boolean' },
          },
          required: ['level', 'passed', 'feedback', 'gap', 'false_confidence'],
        },
      },
    }),
  )
  const parsed = parseAIJson<any>(raw)
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
  if (turns.length >= Number(session.max_questions ?? 7)) return
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
  const minQuestions = Number(session.min_questions ?? 3)
  const maxQuestions = Number(session.max_questions ?? 7)
  if (queuedCount > 0 || total >= minQuestions || total >= maxQuestions) return
  await createTurn({ db, session, source: session.mode === 'spot_check' ? 'spot_check' : 'baseline', status: 'queued' })
}

const EVAL_FALLBACK: EvaluationResult = {
  level: 2,
  passed: false,
  feedback: "We weren't able to review this answer right now — it won't count against your result.",
  gap: null,
  false_confidence: false,
}

async function processAnsweredTurn(db: Db, sessionId: string, turnId: string) {
  const [session, turn] = await Promise.all([
    db.collection('examSessions').findOne({ _id: sessionId as any, status: 'active' }),
    db.collection('examTurns').findOne({ _id: turnId as any, session_id: sessionId }),
  ])
  if (!session || !turn || turn.evaluation || turn.answer == null) return

  let evaluation: EvaluationResult
  try {
    evaluation = await evaluateTurn(db, session, turn)
  } catch (err) {
    console.warn('[examEngine] evaluateTurn failed after retries, writing fallback for turn', turnId, err)
    // Write a fallback so the session can finalize cleanly without a stuck unevaluated turn
    evaluation = EVAL_FALLBACK
    await db.collection('examTurns').updateOne(
      { _id: turn._id },
      {
        $set: {
          evaluation,
          status: 'evaluated',
          evaluated_at: new Date(),
          updated_at: new Date(),
          evaluation_failed: true,
        },
      },
    )
  }

  try {
    await maybeInsertFollowup(db, session, turn, evaluation)
  } catch (err) {
    console.warn('[examEngine] maybeInsertFollowup failed for turn', turnId, err)
  }
  await topUpQueue(db, sessionId)
}

// Derive the most useful regeneration approach from exam failure signals.
// Called only when the student did not pass, to guide adaptive page regeneration.
function deriveReviewApproach(
  evaluations: { turn: any; evaluation: EvaluationResult }[],
): 'simplify' | 'show_example' | 'explain_again' {
  const levels = evaluations.map((e) => Number(e.evaluation.level ?? 2))
  const avgLevel = levels.reduce((sum, l) => sum + l, 0) / Math.max(1, levels.length)
  const hasFalseConfidence = evaluations.some((e) => e.evaluation.false_confidence)
  const failedCodeOrApply = evaluations.some(
    (e) => !e.evaluation.passed && (e.turn.type === 'code' || e.turn.type === 'apply'),
  )

  // Student is genuinely lost — simplify the explanation
  if (avgLevel <= 1.5) return 'simplify'
  // Student can recall but can't apply, or has false confidence — show concrete examples
  if (hasFalseConfidence || failedCodeOrApply) return 'show_example'
  // Student has partial understanding but needs a fresh angle
  return 'explain_again'
}

async function finalizeExam(db: Db, session: any) {
  let detectedPrerequisiteGap: Awaited<ReturnType<typeof detectPrerequisiteGap>> = null
  const turns = await getSessionTurns(db, String(session._id))
  const unevaluated = turns.filter((turn) => turn.answer != null && !turn.evaluation)
  if (unevaluated.length) {
    await Promise.all(unevaluated.map((turn) => evaluateTurn(db, session, turn)))
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

    // Write adaptive review signal to topic — picked up by page regeneration
    const reviewSignal = passed
      ? { needs_review: false, review_approach: null, review_gaps: [] }
      : {
          needs_review: true,
          review_approach: deriveReviewApproach(evaluations),
          review_gaps: weakGaps.slice(0, 4),
        }
    await db.collection('topics').updateOne(
      { _id: session.topic_id as any, course_id: session.course_id },
      { $set: { ...reviewSignal, updated_at: new Date() } },
    )

    if (passed) {
      await unlockNextTopics(String(session.course_id), String(session.topic_id))

      // Spaced repetition: a passed topic becomes a future review. Schedule the
      // first retrieval and clear any stale prerequisite-gap flag from prior fails.
      try {
        await scheduleTopicReview({
          db,
          courseId: String(session.course_id),
          topicId: String(session.topic_id),
          userId: String(session.user_id),
          passed: true,
          overallLevel,
        })
      } catch (err) {
        console.warn('[examEngine] scheduleTopicReview failed:', err)
      }
      await db.collection('topics').updateOne(
        { _id: session.topic_id as any, course_id: session.course_id },
        { $set: { prerequisite_gap: null, updated_at: new Date() } },
      )
    } else {
      // Failed: this isn't a review candidate yet — drop any pending review so we
      // don't quiz them on something they haven't mastered.
      try {
        await cancelTopicReview({
          db,
          courseId: String(session.course_id),
          topicId: String(session.topic_id),
          userId: String(session.user_id),
        })
      } catch (err) {
        console.warn('[examEngine] cancelTopicReview failed:', err)
      }

      // Prerequisite gap detection: after a second failed attempt, check whether the
      // mistakes actually trace back to an earlier topic, and flag it if so.
      try {
        const failedAttempts = await db.collection('quizAttempts').countDocuments({
          course_id: String(session.course_id),
          topic_id: String(session.topic_id),
          user_id: String(session.user_id),
          passed: false,
        })
        if (failedAttempts >= 2) {
          const topicDoc = await db.collection('topics').findOne(
            { _id: session.topic_id as any, course_id: session.course_id },
            { projection: { title: 1, prerequisites: 1 } },
          )
          if (topicDoc) {
            const failedItems = evaluations
              .filter((item) => !item.evaluation.passed)
              .map((item) => ({ concept: String(item.turn.concept ?? ''), gap: item.evaluation.gap }))
            const gap = await detectPrerequisiteGap({
              db,
              courseId: String(session.course_id),
              topic: topicDoc as any,
              failedItems,
            })
            if (gap) {
              detectedPrerequisiteGap = gap
              await db.collection('topics').updateOne(
                { _id: session.topic_id as any, course_id: session.course_id },
                { $set: { prerequisite_gap: gap, updated_at: new Date() } },
              )
            }
          }
        }
      } catch (err) {
        console.warn('[examEngine] prerequisite gap detection failed:', err)
      }
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

        const topicBulkOps: any[] = []
        for (const update of graphUpdate.updates) {
          const $set: Record<string, unknown> = { updated_at: new Date() }
          if (update.state !== undefined) $set.state = update.state
          if (update.mastery !== undefined) $set.understanding_level = Math.round(update.mastery / 20)
          if (update.misconception !== undefined) $set.misconception = update.misconception
          if (update.suggested !== undefined) $set.suggested = update.suggested
          topicBulkOps.push({ updateOne: { filter: { _id: update.topicId as any, course_id: session.course_id }, update: { $set } } })
        }
        for (const unlockId of graphUpdate.unlocked) {
          topicBulkOps.push({ updateOne: { filter: { _id: unlockId as any, course_id: session.course_id, state: 'locked' }, update: { $set: { state: 'active', updated_at: new Date() } } } })
        }
        if (topicBulkOps.length) {
          await db.collection('topics').bulkWrite(topicBulkOps, { ordered: false })
        }

        if (graphUpdate.nextSuggestedTopicId) {
          await db.collection('topics').updateMany(
            { course_id: session.course_id, _id: { $ne: graphUpdate.nextSuggestedTopicId as any } },
            { $set: { suggested: false } },
          )
        }
      }
    } catch (error) {
      console.warn('[examEngine] Graph update failed:', error)
    }
  }

  // Spaced repetition: a review session advances or resets the topic's cadence.
  if (session.is_review) {
    try {
      await recordReviewResult({
        db,
        courseId: String(session.course_id),
        topicId: String(session.topic_id),
        userId: String(session.user_id),
        passed,
      })
    } catch (err) {
      console.warn('[examEngine] recordReviewResult failed:', err)
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
    prerequisite_gap: detectedPrerequisiteGap
      ? { topic_id: detectedPrerequisiteGap.topic_id, title: detectedPrerequisiteGap.title, reason: detectedPrerequisiteGap.reason }
      : null,
  }

  await db.collection('examSessions').updateOne(
    { _id: session._id },
    { $set: { status: 'completed', summary, completed_at: new Date(), updated_at: new Date() } },
  )
  await syncLearnerMemoryV2({
    db,
    userId: String(session.user_id),
    courseId: String(session.course_id),
    force: true,
  }).catch((error) => {
    console.warn('[examEngine] Memory V2 sync failed:', error)
  })
  await db.collection('learnerProfiles').deleteOne({
    user_id: String(session.user_id),
    course_id: String(session.course_id),
  })
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
  const maxQuestions = Number(freshSession?.max_questions ?? 7)
  const minQuestions = Number(freshSession?.min_questions ?? 3)
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
