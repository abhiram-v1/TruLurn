import { NextResponse } from 'next/server'
import { generateAIResult, parseAIJson } from '@/lib/ai'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'

type InterruptionDecision = {
  decision?: unknown
  defer_seconds?: unknown
  reason?: unknown
  confidence?: unknown
}

const MIN_DEFER_SECONDS = 20
const MAX_DEFER_SECONDS = 180

function boundedNumber(value: unknown, minimum: number, maximum: number) {
  const number = Number(value)
  if (!Number.isFinite(number)) return minimum
  return Math.min(maximum, Math.max(minimum, Math.round(number)))
}

function compactText(value: unknown, maximumLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maximumLength) : ''
}

// POST /api/recall/interruption
// AI is used only after a break is already due and local heuristics find
// an ambiguous interruption point. No lesson text, chat, or selected text is sent.
export async function POST(request: Request) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8_000)

  try {
    const userId = await getRequiredUserId()
    const body = await request.json()
    const courseId = compactText(body.courseId, 160)

    if (!courseId) {
      return NextResponse.json({ error: 'Missing course id.' }, { status: 400 })
    }

    const db = await getDb()
    const course = await db.collection('courses').findOne(
      { _id: courseId as any, user_id: userId },
      { projection: { _id: 1 } },
    )
    if (!course) {
      return NextResponse.json({ error: 'Course not found.' }, { status: 404 })
    }

    const signals = {
      topic_title: compactText(body.topicTitle, 120),
      page_number: boundedNumber(body.pageNumber, 1, 10_000),
      due_reason: compactText(body.reason, 180),
      natural_transition: Boolean(body.naturalPoint),
      idle_seconds: boundedNumber(body.idleSeconds, 0, 600),
      interactions_last_30_seconds: boundedNumber(body.interactionsLast30Seconds, 0, 100),
      pending_seconds: boundedNumber(body.pendingSeconds, 0, 900),
      tab_visible: Boolean(body.tabVisible),
    }

    const result = await generateAIResult({
      feature: 'recall_interruption',
      responseMimeType: 'application/json',
      signal: controller.signal,
      system: `You are TruLurn's interruption-timing classifier.

A healthy-break recommendation is already due. Decide only whether the app should show its small, non-modal suggestion banner now or defer it briefly.

Protect deep focus:
- Prefer showing at natural transitions, genuine pauses, or low-interaction moments.
- Defer during rapid interaction or when the learner appears to be actively working.
- A page transition is useful evidence, but it is not automatically a safe interruption.
- Do not defer indefinitely. The application has deterministic maximum-delay safeguards.
- Never infer mastery, emotion, attention disorders, or personal traits.

Return JSON only:
{
  "decision": "show_now" | "defer",
  "defer_seconds": number,
  "reason": "short operational explanation",
  "confidence": "low" | "medium" | "high"
}`,
      user: `Classify this coarse interaction snapshot:
${JSON.stringify(signals)}`,
    })

    const parsed = parseAIJson<InterruptionDecision>(result.text)
    const decision = parsed.decision === 'show_now' ? 'show_now' : 'defer'
    const confidence = ['low', 'medium', 'high'].includes(String(parsed.confidence))
      ? String(parsed.confidence)
      : 'low'

    return NextResponse.json({
      provider: result.provider,
      decision,
      deferSeconds:
        decision === 'show_now'
          ? 0
          : boundedNumber(parsed.defer_seconds, MIN_DEFER_SECONDS, MAX_DEFER_SECONDS),
      reason: compactText(parsed.reason, 180),
      confidence,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not classify interruption timing.'
    const status = message.toLowerCase().includes('sign in') ? 401 : 503
    return NextResponse.json({ error: message }, { status })
  } finally {
    clearTimeout(timeout)
  }
}
