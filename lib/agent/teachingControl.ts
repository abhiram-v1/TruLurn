import crypto from 'crypto'
import type { Db } from 'mongodb'
import { generateAI, parseAIJson } from '@/lib/ai'
import { upsertLearnerMemory } from '@/lib/memory/service'

export type TeachingAdjustment = {
  knowledgeLevel: 'beginner' | 'intermediate' | 'expert' | null
  sourceCoverage: 'complete' | 'smart' | 'core' | null
  audienceLabel: string | null
}

const DIFFICULTY_HINT =
  /\b(treat me|assume|beginner|newbie|novice|intermediate|expert|advanced|too basic|too simple|too easy|too hard|too difficult|too advanced|over my head)\b/i

const COVERAGE_HINT =
  /\b(cover (?:everything|all|every)|don'?t (?:skip|leave out|miss|drop)|every (?:point|detail|reason|step)|only the (?:important|key|main)|just the (?:important|key|main)|key points only|less detail|my notes|the notes|my material|the source|exam|test (?:prep|next|tomorrow|coming))\b/i

const AUDIENCE_HINT =
  /\b(i'?m (?:a|an|not)|i am (?:a|an|not)|as a college|as an?\s+\w+ (?:i|my)|for (?:my|our) (?:job|work|team|class(?:room)?|students|company|startup|thesis|research|interview)|i (?:work|teach|study) |my (?:job|profession|career|students|pupils)|i'?m (?:preparing|studying|learning) (?:to teach|for (?:an? )?(?:interview|certification|job)))\b/i

export function mightBeTeachingAdjustment(question: string): boolean {
  return DIFFICULTY_HINT.test(question) || COVERAGE_HINT.test(question) || AUDIENCE_HINT.test(question)
}

export async function detectTeachingAdjustment(
  question: string,
): Promise<TeachingAdjustment | null> {
  if (!mightBeTeachingAdjustment(question)) return null

  try {
    const text = await generateAI({
      feature: 'agent_style',
      system: `Extract explicit learner settings from a message. This is not a style selector: do not convert requests about tone, examples, storytelling, code, math, or lesson format into persistent instructions. Return only JSON.`,
      user: `Message:
"""${question.slice(0, 800)}"""

Return exactly:
{
  "is_adjustment": true|false,
  "knowledge_level": "beginner|intermediate|expert|null",
  "source_coverage": "complete|smart|core|null",
  "learner_audience": "who they explicitly say they are or why they are learning, in 3-10 words, or null"
}

Set is_adjustment only when the learner explicitly changes assumed knowledge, uploaded-source coverage, or their own role/context. Ordinary content questions and requests for a different explanation style are false.`,
      purpose: 'agent',
      responseMimeType: 'application/json',
    })

    const parsed = parseAIJson<{
      is_adjustment?: boolean
      knowledge_level?: string | null
      source_coverage?: string | null
      learner_audience?: string | null
    }>(text)
    if (!parsed?.is_adjustment) return null

    const level = parsed.knowledge_level
    const coverage = parsed.source_coverage
    const audienceLabel = String(parsed.learner_audience ?? '').trim() || null
    const adjustment: TeachingAdjustment = {
      knowledgeLevel: level === 'beginner' || level === 'intermediate' || level === 'expert'
        ? level
        : null,
      sourceCoverage: coverage === 'complete' || coverage === 'smart' || coverage === 'core'
        ? coverage
        : null,
      audienceLabel: audienceLabel ? audienceLabel.slice(0, 120) : null,
    }
    return adjustment.knowledgeLevel || adjustment.sourceCoverage || adjustment.audienceLabel
      ? adjustment
      : null
  } catch (error) {
    console.warn('Teaching adjustment detection failed.', error)
    return null
  }
}

export async function applyTeachingAdjustment({
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
  adjustment: TeachingAdjustment
}): Promise<void> {
  const course = await db.collection('courses').findOne(
    { _id: courseId as any, user_id: userId },
    { projection: { mode: 1 } },
  )
  if (!course) return

  const set: Record<string, unknown> = { updated_at: new Date() }
  if (adjustment.knowledgeLevel) set.knowledge_level = adjustment.knowledgeLevel
  if (adjustment.sourceCoverage && String(course.mode ?? '') === 'source_grounded') {
    set.source_coverage_preference = adjustment.sourceCoverage
  }
  if (adjustment.audienceLabel) {
    set.learner_audience = {
      label: adjustment.audienceLabel,
      directive: '',
      source: 'stated',
    }
  }
  await db.collection('courses').updateOne(
    { _id: courseId as any, user_id: userId },
    { $set: set },
  )

  const writes: Promise<unknown>[] = []
  if (adjustment.knowledgeLevel) {
    writes.push(upsertLearnerMemory(db, {
      userId,
      courseId,
      kind: 'preference',
      key: 'teaching.knowledge_level',
      value: adjustment.knowledgeLevel,
      confidence: 1,
      authority: 'explicit_user',
      source: 'agent_teaching_adjustment',
    }))
  }
  if (adjustment.sourceCoverage) {
    writes.push(upsertLearnerMemory(db, {
      userId,
      courseId,
      kind: 'preference',
      key: 'teaching.source_coverage',
      value: adjustment.sourceCoverage,
      confidence: 1,
      authority: 'explicit_user',
      source: 'agent_teaching_adjustment',
    }))
  }
  if (adjustment.audienceLabel) {
    writes.push(upsertLearnerMemory(db, {
      userId,
      courseId,
      kind: 'profile',
      key: 'learner.audience',
      value: adjustment.audienceLabel,
      confidence: 1,
      authority: 'explicit_user',
      source: 'agent_teaching_adjustment',
    }))
  }
  await Promise.all(writes)
  await db.collection('learnerProfiles').deleteOne({ user_id: userId, course_id: courseId })

  await db.collection('learningEvents').insertOne({
    _id: crypto.randomUUID() as any,
    course_id: courseId,
    topic_id: topicId,
    user_id: userId,
    event_type: 'teaching_adjustment_applied',
    knowledge_level: adjustment.knowledgeLevel,
    source_coverage: adjustment.sourceCoverage,
    learner_audience: adjustment.audienceLabel,
    created_at: new Date(),
  })
}
