import { generateAI, parseAIJson } from '@/lib/ai'
import type { SourceTeachingProfile } from '@/lib/course-generation/sourceProfile'

// ── Learner persona ───────────────────────────────────────────────────────────
//
// The app must never assume the learner is a school student. Who they are —
// a working engineer upskilling, a hobbyist, an educator preparing to teach,
// an undergrad before an exam, a career switcher — changes how lessons,
// quizzes, doubt answers, and recall prompts should address them and which
// examples and stakes land.
//
// Following the adaptive principle (no new setup questions, no knobs), the
// persona is DERIVED from what the user already gave us: their goals text,
// knowledge level, learning purpose, and the uploaded material's profile.
// It is derived once at course creation, stored on the course, and remains
// correctable mid-course through the in-app agent ("I'm actually a teacher
// preparing lessons") — generators read it fresh on every call.

export type LearnerAudienceProfile = {
  /** Who this learner is, e.g. "working backend engineer moving into ML". */
  label: string
  /** Writer-ready guidance: framing, example worlds, stakes, what to avoid. */
  directive: string
  /** derived = inferred from setup signals; stated = the learner told the agent. */
  source: 'derived' | 'stated'
}

/**
 * Infer who this learner is from course-creation signals. One cheap call,
 * fail-open: course generation proceeds without a persona on any failure,
 * and generators fall back to an assumption-free audience directive.
 */
export async function deriveLearnerAudience({
  goals,
  knowledgeLevel,
  learningPurpose,
  sourceProfile,
}: {
  goals: string
  knowledgeLevel?: string | null
  learningPurpose?: string | null
  sourceProfile?: any | null
}): Promise<LearnerAudienceProfile | null> {
  try {
    const isV2 = sourceProfile && 'schema_version' in sourceProfile && sourceProfile.schema_version === 'source-profile-v2'
    const meta = isV2 ? sourceProfile.metadata : sourceProfile
    const sourceHint = meta
      ? `\nThey uploaded study material profiled as: ${meta.document_type}, educational level "${meta.educational_level}", subject "${meta.subject_domain}".`
      : ''

    const text = await generateAI({
      feature: 'learner_audience',
      system: `You infer who a learner is from how they describe their learning goal, so an AI tutor can address them appropriately. People who use this app include working professionals, hobbyists, career switchers, school and university students, educators preparing to teach, researchers, parents, retirees — never assume any one of these by default. Return only valid JSON.`,
      user: `The learner wrote this goal:
"""${goals.slice(0, 1200)}"""

Self-assessed knowledge level: ${knowledgeLevel ?? 'unknown'}
Learning purpose: ${learningPurpose ?? 'unknown'}${sourceHint}

Return exactly:
{
  "label": "who this learner most plausibly is, in 3-10 words (e.g. 'working data analyst upskilling for ML roles', 'university student preparing for a semester exam', 'hobbyist learning for personal interest')",
  "directive": "2-3 sentences of writer-ready guidance: how to address them, which worlds to draw examples and stakes from, and which framings to avoid (e.g. avoid classroom/exam framing for a professional; avoid workplace jargon for a school student)",
  "confidence": "low|medium|high"
}

Rules:
- Infer only what the goal text actually supports. If it gives no real signal, set confidence "low" and write a deliberately broad label like "self-directed adult learner" with neutral guidance.
- Mentions of exams, semesters, professors, or coursework → likely a student; mention exam framing is welcome.
- Mentions of work, job, clients, interviews, projects, or career → professional framing; avoid school assumptions.
- Never invent demographic details (age, gender, country) the text doesn't support.`,
      responseMimeType: 'application/json',
    })

    const parsed = parseAIJson<{ label?: string; directive?: string; confidence?: string }>(text)
    const label = String(parsed?.label ?? '').trim()
    const directive = String(parsed?.directive ?? '').trim()
    if (!label) return null

    return { label: label.slice(0, 120), directive: directive.slice(0, 600), source: 'derived' }
  } catch (error) {
    console.warn('[learnerAudience] Derivation failed - continuing without an audience profile.', error)
    return null
  }
}

/** Validate a persona-shaped value read back from the course document. */
export function normalizeLearnerAudience(raw: unknown): LearnerAudienceProfile | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const label = String(value.label ?? '').trim()
  if (!label) return null
  return {
    label: label.slice(0, 120),
    directive: String(value.directive ?? '').trim().slice(0, 600),
    source: value.source === 'stated' ? 'stated' : 'derived',
  }
}

/**
 * The audience block injected into every user-facing generator (lessons,
 * quizzes, doubt chat, recall). Always returns guidance — with no persona it
 * returns the assumption-free fallback rather than letting prompts default
 * to their historical school-student framing.
 */
export function buildAudienceDirective(
  audience: LearnerAudienceProfile | null | undefined,
  goals?: string | null,
): string {
  const normalized = normalizeLearnerAudience(audience)
  if (normalized) {
    return [
      'AUDIENCE — WHO THIS LEARNER IS:',
      `- ${normalized.source === 'stated' ? 'The learner has told us they are' : 'This learner is'}: ${normalized.label}.`,
      normalized.directive ? `- ${normalized.directive}` : null,
      '- Choose examples, scenarios, and stakes from THIS person\'s world. Use school/exam framing (classes, teachers, semesters, grades) only if that is genuinely who they are; use workplace framing only if they actually work in the field.',
      '- "Student" in these instructions means "the person learning" — never assume a school student.',
    ].filter(Boolean).join('\n')
  }

  return [
    'AUDIENCE — UNKNOWN LEARNER (no profile stored):',
    goals?.trim() ? `- Infer who this learner is from their goal: "${goals.trim().slice(0, 300)}".` : null,
    '- Do NOT default to school-student framing. Learners here are just as often working professionals, hobbyists, career switchers, educators, or researchers.',
    '- Avoid classroom/exam references (teachers, semesters, grades, "your exam") unless the goal clearly indicates a school or exam context.',
    '- "Student" in these instructions means "the person learning" — nothing more.',
  ].filter(Boolean).join('\n')
}
