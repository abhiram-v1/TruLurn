import type { Db } from 'mongodb'
import { generateAI, parseAIJson } from '@/lib/ai'

// ── Prerequisite gap detection ─────────────────────────────────────────────────
// When a student repeatedly fails a topic quiz, the real problem is often not the
// topic itself but an earlier concept it depends on. (Failing backpropagation is
// usually a chain-rule problem, not a backprop problem.)
//
// This analyzes the specific failures against the topic's prerequisite graph and
// asks the model whether the failures point to a *specific* earlier topic. If so,
// it records a `prerequisite_gap` signal on the topic that the doubt tutor and the
// quiz-results UI can surface ("Your answers suggest the issue is actually X").

export type PrerequisiteGap = {
  topic_id: string
  title: string
  reason: string
  detected_at: Date
}

type FailedItem = {
  concept: string
  gap?: string | null
}

function compact(value: unknown, max = 400): string {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}...` : clean
}

/**
 * Analyze quiz failures against prerequisite topics to find the likely root cause.
 * Returns null when the failures are within-topic (no earlier topic is implicated),
 * or when the topic has no prerequisites to blame.
 */
export async function detectPrerequisiteGap({
  db,
  courseId,
  topic,
  failedItems,
}: {
  db: Db
  courseId: string
  topic: { _id: unknown; title?: string; prerequisites?: unknown[] }
  failedItems: FailedItem[]
}): Promise<PrerequisiteGap | null> {
  const prereqIds = Array.isArray(topic.prerequisites)
    ? topic.prerequisites.map((id) => String(id)).filter(Boolean)
    : []
  if (!prereqIds.length || !failedItems.length) return null

  // Pull the candidate prerequisite topics with enough context for the model to judge.
  const prereqTopics = await db.collection('topics')
    .find({ course_id: courseId, _id: { $in: prereqIds as any[] } })
    .project({ title: 1, summary: 1, description: 1 })
    .toArray()

  // Only consider real (non-structural) prerequisites that actually have a title.
  const candidates = prereqTopics
    .map((t) => ({
      id: String(t._id),
      title: String(t.title ?? '').trim(),
      summary: compact(t.summary ?? t.description ?? '', 240),
    }))
    .filter((t) => t.title)

  if (!candidates.length) return null

  const failuresText = failedItems
    .slice(0, 6)
    .map((item, i) => `${i + 1}. Concept: ${item.concept}${item.gap ? `\n   Diagnosed gap: ${compact(item.gap, 220)}` : ''}`)
    .join('\n')

  const candidatesText = candidates
    .map((c, i) => `${i + 1}. [id: ${c.id}] ${c.title}${c.summary ? ` — ${c.summary}` : ''}`)
    .join('\n')

  const system = `You are TruLurn's diagnostic analyst. A student just failed a quiz on a topic.
Your job is to decide whether their specific mistakes are best explained by a weakness in an EARLIER prerequisite topic, rather than the current topic itself.

Think like an experienced teacher: when a student fails backpropagation, the real gap is often the chain rule. When they fail recursion, it's often the call stack. The mistakes leak the true cause.

Rules:
- Only implicate a prerequisite if the failures genuinely trace back to it. Do not force a match.
- If the mistakes are about the current topic's own content (not a foundational dependency), return no gap.
- Pick AT MOST ONE prerequisite — the single most likely root cause.
- The reason must reference the actual failures, not be generic.

Return ONLY valid JSON:
{
  "has_gap": <boolean>,
  "prerequisite_id": "<id from the candidate list, or null>",
  "reason": "<one sentence tying the student's specific mistakes to this prerequisite, or empty string>"
}`

  const user = `Current topic the student failed: ${topic.title ?? 'Unknown topic'}

What the student got wrong:
${failuresText}

Candidate prerequisite topics (the current topic depends on these):
${candidatesText}

Decide whether one of these prerequisites is the real root cause.`

  try {
    const raw = await generateAI({
      feature: 'prerequisite_gap_analysis',
      system,
      user,
      responseMimeType: 'text/plain',
      responseSchema: {
        name: 'prerequisite_gap',
        schema: {
          type: 'object',
          properties: {
            has_gap: { type: 'boolean' },
            prerequisite_id: { type: ['string', 'null'] },
            reason: { type: 'string' },
          },
          required: ['has_gap', 'prerequisite_id', 'reason'],
        },
      },
    })
    const parsed = parseAIJson<any>(raw)
    if (!parsed?.has_gap) return null

    const chosenId = String(parsed.prerequisite_id ?? '').trim()
    const match = candidates.find((c) => c.id === chosenId)
    if (!match) return null

    const reason = compact(parsed.reason ?? '', 260)
    return {
      topic_id: match.id,
      title: match.title,
      reason: reason || `Your answers suggest the foundation from "${match.title}" needs another look.`,
      detected_at: new Date(),
    }
  } catch (err) {
    console.warn('[prerequisiteGaps] detection failed:', err)
    return null
  }
}
