// AI-driven knowledge graph state evaluator.
// Called after quiz completion to update node states, detect misconceptions,
// and recommend the next topic to study.

import { generateWithGemini } from '@/lib/ai/gemini/client'
import { parseGeminiJson } from '@/lib/ai/gemini/json'
import type { GraphNodeState, GraphEvaluationResult, GraphNodeUpdate } from '@/lib/graph/types'

// ── Topic state → graph state mapping ──────────────────────────────────────

function overallLevelToState(level: number): GraphNodeState {
  if (level >= 5) return 'mastered'
  if (level >= 4) return 'functional'
  if (level >= 3) return 'functional'
  if (level >= 2) return 'partial'
  return 'unstable'
}

function levelToMastery(level: number): number {
  return Math.min(100, Math.round(level * 20))
}

// ── Quiz evaluation event ──────────────────────────────────────────────────

export interface QuizEvaluationEvent {
  topicId: string
  topicTitle: string
  passed: boolean
  overallLevel: number        // 1–5
  hasFalseConfidence: boolean
  questionsCount: number
  weakGaps: string[]          // gap descriptions from failed questions
}

export interface CourseTopicSnapshot {
  id: string
  title: string
  state: string
  mastery: number             // 0–100
  prerequisites: string[]
}

export async function evaluateQuizForGraph(
  event: QuizEvaluationEvent,
  courseTopics: CourseTopicSnapshot[],
): Promise<GraphEvaluationResult> {
  // 1. Deterministic state update for the evaluated topic
  const newState = overallLevelToState(event.overallLevel)
  const newMastery = levelToMastery(event.overallLevel)
  const hasMisconception = event.hasFalseConfidence || (event.overallLevel <= 2 && event.weakGaps.length > 0)

  const topicUpdate: GraphNodeUpdate = {
    topicId: event.topicId,
    state: newState,
    mastery: newMastery,
    misconception: hasMisconception,
    suggested: false,
  }

  // 2. Find topics that are now unlockable (all prereqs satisfied)
  const masteredSet = new Set(
    courseTopics
      .filter((t) => t.state === 'mastered' || t.state === 'functional' || t.id === event.topicId && event.passed)
      .map((t) => t.id),
  )

  const unlocked = courseTopics
    .filter(
      (t) =>
        t.state === 'locked' &&
        t.prerequisites.length > 0 &&
        t.prerequisites.every((prereq) => masteredSet.has(prereq)),
    )
    .map((t) => t.id)

  // 3. Ask model for recommended next topic + summary (keep prompt small for low latency).
  const gapsText = event.weakGaps.length > 0 ? event.weakGaps.join('; ') : 'none'

  // Single topic list: id, title, state, mastery — no duplicate compact snapshot needed.
  const availableTopics = courseTopics
    .filter((t) => t.state !== 'locked' && t.id !== event.topicId)
    .slice(0, 30)
    .map((t) => `- ${t.id}: ${t.title} (${t.state}, ${t.mastery}%)`)
    .join('\n')

  const prompt = {
    system: `You are TruLurn's learning advisor. Recommend the single best next topic to study.
Return ONLY valid JSON: {"nextTopicId":"<id or null>","summary":"<one warm direct sentence>"}`,
    user: `Quiz: "${event.topicTitle}" — ${event.passed ? 'PASSED' : 'FAILED'} (level ${event.overallLevel}/5)
Misconception: ${hasMisconception} | Gaps: ${gapsText}

Available topics (id: title, state, mastery):
${availableTopics || 'None available.'}

Which topic ID should the student study next?`,
  }

  let nextSuggestedTopicId: string | null = null
  let summary = event.passed
    ? `Nice work on ${event.topicTitle}! Keep the momentum going.`
    : `You're building understanding of ${event.topicTitle}. Review the gaps and try again.`

  try {
    const raw = await generateWithGemini({ ...prompt, model: 'gemini-2.0-flash-lite', purpose: 'agent' })
    const parsed = parseGeminiJson<{ nextTopicId?: string | null; summary?: string }>(raw)

    if (parsed.nextTopicId && courseTopics.some((t) => t.id === parsed.nextTopicId)) {
      nextSuggestedTopicId = parsed.nextTopicId
    }
    if (parsed.summary) {
      summary = parsed.summary
    }
  } catch (err) {
    // Non-fatal: fall back to the deterministic summary above
    console.warn('[graphEvaluator] Gemini suggestion failed, using defaults:', err)
  }

  // 4. Build the final update list
  const updates: GraphNodeUpdate[] = [topicUpdate]

  if (nextSuggestedTopicId) {
    // Clear suggested from all others implicitly via the update endpoint,
    // just mark this one
    updates.push({ topicId: nextSuggestedTopicId, suggested: true })
  }

  return { updates, unlocked, nextSuggestedTopicId, summary }
}

// ── Lesson-progress evaluation (lightweight, no AI) ────────────────────────

export function evaluateLessonProgress(
  topicId: string,
  currentMastery: number,
  pagesCompleted: number,
  totalPages: number,
): GraphNodeUpdate {
  // Each page completion gives a small mastery bump if the topic isn't yet functional
  const pageRatio = totalPages > 0 ? pagesCompleted / totalPages : 0
  const bump = Math.round(pageRatio * 15) // max +15% from reading alone
  const newMastery = Math.min(100, currentMastery + bump)

  // State only upgrades from active → partial if enough pages read
  let state: GraphNodeState | undefined
  if (pageRatio >= 0.5 && currentMastery < 30) {
    state = 'partial'
  }

  return { topicId, mastery: newMastery, state }
}
