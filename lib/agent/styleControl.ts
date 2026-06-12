import crypto from 'crypto'
import type { Db } from 'mongodb'
import { generateAI, parseAIJson } from '@/lib/ai'
import { upsertLearnerMemory } from '@/lib/memory/service'

// ── Agent style control ───────────────────────────────────────────────────────
//
// Lets the in-app agent ACT on teaching-style feedback instead of just replying.
// When the student tells the tutor something like "stop assuming I know the key
// terms — treat me as a beginner", the agent:
//   1. detects the request (cheap keyword gate → small model confirmation),
//   2. persists it on the course (knowledge_level and/or a durable directive),
//   3. acknowledges it in the answer.
// Every future lesson page reads these course fields at generation time, so the
// adjustment applies automatically without the student touching settings.

export type StyleAdjustment = {
  knowledgeLevel: 'beginner' | 'intermediate' | 'expert' | null
  /** Source-coverage stance the student asked for (source-based courses only). */
  sourceCoverage: 'complete' | 'smart' | 'core' | null
  /** Who the learner says they are ("I'm a teacher preparing lessons"). */
  personaLabel: string | null
  directive: string
}

// Cheap gate — only call the model when the message plausibly talks about
// teaching style. Keeps the doubt pipeline fast for normal questions.
const STYLE_HINT =
  /\b(treat me|assume|assumes|assuming|beginner|newbie|novice|expert|advanced|too basic|too simple|too easy|too hard|too difficult|too advanced|jargon|terminology|key terms|technical terms|simpler|simplify|dumb(?:\s+it)?\s+down|more examples|fewer examples|less math|more math|less theory|more theory|explain like|eli5|teaching style|lesson style|page style|tone|slow down|too fast|over my head)\b/i

// Coverage requests for source-based courses: "don't skip anything from my
// notes", "exam next week, cover everything", "just the key points".
const COVERAGE_HINT =
  /\b(cover (?:everything|all|every)|don'?t (?:skip|leave out|miss|drop)|skipp(?:ed|ing)|left out|miss(?:ed|ing) (?:a |any|some)|every (?:point|detail|reason|step)|all the (?:points|details|reasons|steps)|word for word|too (?:detailed|thorough|exhaustive)|only the (?:important|key|main)|just the (?:important|key|main)|key points only|less detail|too much detail|my notes|the notes|my material|the source|exam|test (?:prep|next|tomorrow|coming))\b/i

// Persona statements: the learner telling us who they are, so lessons stop
// framing them as something they're not ("I'm not a student, I'm a nurse").
const PERSONA_HINT =
  /\b(i'?m (?:a|an|not)|i am (?:a|an|not)|as a college|as an?\s+\w+ (?:i|my)|for (?:my|our) (?:job|work|team|class(?:room)?|students|company|startup|thesis|research|interview)|i (?:work|teach|study) |my (?:job|profession|career|students|pupils)|i'?m (?:preparing|studying|learning) (?:to teach|for (?:an? )?(?:interview|certification|job)))\b/i

export function mightBeStyleRequest(question: string): boolean {
  return STYLE_HINT.test(question) || COVERAGE_HINT.test(question) || PERSONA_HINT.test(question)
}

/**
 * Confirm + extract a style adjustment from a student message. Returns null
 * unless the message is genuinely asking to change HOW lessons teach (not just
 * asking a content question that happens to mention "examples" or "basic").
 */
export async function detectStyleAdjustment(question: string): Promise<StyleAdjustment | null> {
  if (!mightBeStyleRequest(question)) return null

  try {
    const text = await generateAI({
      feature: 'agent_style',
      system: `You decide whether a student message is a request to change the TEACHING STYLE of their course lessons (vs an ordinary content question). Return only JSON.`,
      user: `Student message:
"""${question.slice(0, 800)}"""

Is this a request to change how future lessons are written (difficulty level, assumed knowledge, amount of jargon, examples, math/theory balance, tone, pacing), a statement about WHO the learner is (their role, work, or context), or — for courses built from uploaded material — how much of that material lessons must cover?

Return exactly:
{
  "is_style_request": true|false,
  "knowledge_level": "beginner|intermediate|expert|null",
  "source_coverage": "complete|smart|core|null",
  "learner_persona": "who they say they are, in 3-10 words, or null",
  "directive": "one imperative sentence for the lesson writer capturing the request, or empty string"
}

Rules:
- is_style_request is true ONLY for explicit requests about how lessons teach. A content question ("what is a basic example of X?") is false.
- knowledge_level: set only when the student clearly asks to be treated at that level; otherwise null.
- source_coverage: set only when the student asks about how much of their uploaded material to cover:
    "complete" — cover everything, skip nothing ("exam next week, don't leave anything out of my notes").
    "smart" — back to balanced coverage ("the normal amount of detail is fine").
    "core" — key concepts only ("stop going through every little detail, just the important parts").
  Otherwise null.
- learner_persona: set only when the message genuinely states who the learner is or why they're learning (e.g. "practicing nurse learning pharmacology for work", "high-school teacher preparing lessons", "engineer preparing for ML interviews"). A content question that merely mentions a job is null. Never invent details.
- directive: concrete and writer-ready, e.g. "Do not assume prior knowledge of key terms — define every technical term when first used." Empty when is_style_request is false. A pure coverage or persona change may leave directive empty.`,
      purpose: 'agent',
      responseMimeType: 'application/json',
    })

    const parsed = parseAIJson<{
      is_style_request?: boolean
      knowledge_level?: string | null
      source_coverage?: string | null
      learner_persona?: string | null
      directive?: string
    }>(text)

    if (!parsed?.is_style_request) return null
    const directive = String(parsed.directive ?? '').trim()
    const coverage = parsed.source_coverage
    const sourceCoverage = coverage === 'complete' || coverage === 'smart' || coverage === 'core' ? coverage : null
    const personaLabel = String(parsed.learner_persona ?? '').trim() || null
    // A pure coverage or persona change needs no directive; anything else does.
    if (!directive && !sourceCoverage && !personaLabel) return null

    const level = parsed.knowledge_level
    return {
      knowledgeLevel: level === 'beginner' || level === 'intermediate' || level === 'expert' ? level : null,
      sourceCoverage,
      personaLabel: personaLabel ? personaLabel.slice(0, 120) : null,
      directive: directive.slice(0, 300),
    }
  } catch (error) {
    console.warn('Style adjustment detection failed.', error)
    return null
  }
}

const MAX_DIRECTIVES = 5

/**
 * Persist the adjustment on the course so every future page generation picks it
 * up (generateTopicPage reads knowledge_level + style_directives fresh each call).
 * Also logs a learning event so the change is auditable.
 */
export async function applyStyleAdjustment({
  db,
  courseId,
  userId,
  topicId,
  adjustment,
}: {
  db: Db
  courseId: string
  userId: string
  topicId: string
  adjustment: StyleAdjustment
}): Promise<void> {
  const course = await db.collection('courses').findOne(
    { _id: courseId as any, user_id: userId },
    { projection: { style_directives: 1, knowledge_level: 1, mode: 1 } },
  )
  if (!course) return

  const existing: string[] = Array.isArray(course.style_directives) ? course.style_directives : []
  // Skip near-duplicate directives (same lowercased text already stored)
  const isDuplicate = !adjustment.directive || existing.some(
    (d) => String(d).toLowerCase().trim() === adjustment.directive.toLowerCase().trim(),
  )
  const directives = isDuplicate ? existing : [...existing, adjustment.directive].slice(-MAX_DIRECTIVES)

  const set: Record<string, unknown> = {
    style_directives: directives,
    updated_at: new Date(),
  }
  if (adjustment.knowledgeLevel) set.knowledge_level = adjustment.knowledgeLevel
  // Coverage preference feeds the source fidelity policy (sourceFidelity.ts),
  // which future page generations and topic plans resolve fresh — so this one
  // write adapts the rest of the course. Only meaningful for source courses.
  if (adjustment.sourceCoverage && String(course.mode ?? '') === 'source_grounded') {
    set.source_coverage_preference = adjustment.sourceCoverage
  }
  // The learner told us who they are — a stated persona outranks the derived
  // one. Every generator (lessons, quizzes, doubt, recall) reads it fresh.
  if (adjustment.personaLabel) {
    set.learner_persona = { label: adjustment.personaLabel, directive: '', source: 'stated' }
  }

  await db.collection('courses').updateOne({ _id: courseId as any, user_id: userId }, { $set: set })

  const memoryWrites: Promise<unknown>[] = []
  if (adjustment.knowledgeLevel) {
    memoryWrites.push(upsertLearnerMemory(db, {
      userId,
      courseId,
      kind: 'preference',
      key: 'teaching.knowledge_level',
      value: adjustment.knowledgeLevel,
      confidence: 1,
      authority: 'explicit_user',
      source: 'agent_style_adjustment',
    }))
  }
  if (adjustment.sourceCoverage) {
    memoryWrites.push(upsertLearnerMemory(db, {
      userId,
      courseId,
      kind: 'preference',
      key: 'teaching.source_coverage',
      value: adjustment.sourceCoverage,
      confidence: 1,
      authority: 'explicit_user',
      source: 'agent_style_adjustment',
    }))
  }
  if (adjustment.personaLabel) {
    memoryWrites.push(upsertLearnerMemory(db, {
      userId,
      courseId,
      kind: 'profile',
      key: 'learner.persona',
      value: adjustment.personaLabel,
      confidence: 1,
      authority: 'explicit_user',
      source: 'agent_style_adjustment',
    }))
  }
  if (adjustment.directive) {
    const directiveKey = crypto.createHash('sha1')
      .update(adjustment.directive.toLowerCase().trim())
      .digest('hex')
      .slice(0, 12)
    memoryWrites.push(upsertLearnerMemory(db, {
      userId,
      courseId,
      kind: 'preference',
      key: `teaching.directive.${directiveKey}`,
      value: adjustment.directive,
      confidence: 1,
      authority: 'explicit_user',
      source: 'agent_style_adjustment',
    }))
  }
  await Promise.all(memoryWrites)
  await db.collection('learnerProfiles').deleteOne({ user_id: userId, course_id: courseId })

  await db.collection('learningEvents').insertOne({
    _id: crypto.randomUUID() as any,
    course_id: courseId,
    topic_id: topicId,
    user_id: userId,
    event_type: 'style_adjustment_applied',
    directive: adjustment.directive,
    knowledge_level: adjustment.knowledgeLevel,
    source_coverage: adjustment.sourceCoverage,
    learner_persona: adjustment.personaLabel,
    created_at: new Date(),
  })
}
