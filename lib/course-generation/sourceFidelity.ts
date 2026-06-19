import type { SourceTeachingProfile, SourceProfileEnvelope } from '@/lib/course-generation/sourceProfile'

// ── Adaptive source fidelity policy ──────────────────────────────────────────
//
// Source-based courses need a coverage stance: how much of the uploaded
// material must appear in lessons, how densely it is presented, and how much
// the AI enriches beyond it. A fixed answer is wrong in both directions —
// "cover 100%, always" bloats a casual course; "summarize freely" silently
// drops content an exam student needs.
//
// So the policy is DERIVED, never asked: a pure function of signals the
// system already has — course depth, learning purpose,
// the source profile's own exam signals, and any explicit coverage request
// the student made through the in-app agent. It is recomputed fresh on every
// generation call, so when any of those signals change mid-course (style
// switch, agent request), every future page and topic plan adapts
// automatically. Teaching persona controls delivery, not source scope.

export type SourceCoverageLevel = 'complete' | 'smart' | 'core'
export type SourcePresentation = 'compact' | 'standard' | 'expansive'
export type SourceAmplification = 'light' | 'standard' | 'rich'

export type SourceFidelityPolicy = {
  /** How much of the source's teaching points must appear in lessons. */
  coverage: SourceCoverageLevel
  /** How densely covered material is presented. */
  presentation: SourcePresentation
  /** How much the AI enriches and repairs beyond the source. */
  amplification: SourceAmplification
  /** Stable cache/staleness key — topic plans regenerate when this changes. */
  key: string
  /** Human-readable trail of how the policy was derived (for events/debugging). */
  reasons: string[]
}

export type SourceFidelitySignals = {
  mode?: string | null
  courseDepth?: string | null
  learningPurpose?: string | null
  sourceProfile?: SourceTeachingProfile | SourceProfileEnvelope | null
  /** Explicit student request persisted by the agent — overrides derived coverage. */
  coveragePreference?: string | null
}

type PolicyBase = {
  coverage: SourceCoverageLevel
  presentation: SourcePresentation
  amplification: SourceAmplification
}

const DEFAULT_BASE: PolicyBase & { why: string } = {
  coverage: 'smart', presentation: 'standard', amplification: 'standard',
  why: 'Base source stance: all substantive points covered, peripheral detail compressible.',
}

const COVERAGE_ORDER: SourceCoverageLevel[] = ['core', 'smart', 'complete']
const AMP_ORDER: SourceAmplification[] = ['light', 'standard', 'rich']

function shift<T>(order: T[], value: T, delta: number): T {
  const index = Math.max(0, order.indexOf(value))
  return order[Math.min(order.length - 1, Math.max(0, index + delta))]
}

function isCoverageLevel(value: unknown): value is SourceCoverageLevel {
  return value === 'complete' || value === 'smart' || value === 'core'
}

/**
 * Derive the fidelity policy for a source-grounded course. Returns null for
 * ai_teacher courses — they have no source boundary to manage.
 *
 * Pure and cheap: callers resolve it fresh at every generation so the policy
 * always reflects the CURRENT course state.
 */
export function resolveSourceFidelityPolicy(signals: SourceFidelitySignals): SourceFidelityPolicy | null {
  if (String(signals.mode ?? '') !== 'source_grounded') return null

  const reasons: string[] = []
  const base = DEFAULT_BASE
  reasons.push(base.why)

  let { coverage, presentation, amplification } = base

  // The material itself signals exam preparation → coverage must be complete
  // regardless of style. A student with exam notes can't afford dropped points.
  let examSignals = 0
  if (signals.sourceProfile) {
    if ('schema_version' in signals.sourceProfile && signals.sourceProfile.schema_version === 'source-profile-v2') {
      examSignals = signals.sourceProfile.metadata?.exam_signals?.length ?? 0
    } else {
      examSignals = (signals.sourceProfile as SourceTeachingProfile).exam_signals?.length ?? 0
    }
  }
  if (examSignals >= 2 && coverage !== 'complete') {
    coverage = 'complete'
    reasons.push('Source material carries exam signals — raised coverage to complete.')
  }

  // Course depth shifts density and enrichment, not the coverage contract.
  if (signals.courseDepth === 'low') {
    presentation = 'compact'
    amplification = shift(AMP_ORDER, amplification, -1)
    reasons.push('Low course depth — compact presentation, restrained enrichment.')
  } else if (signals.courseDepth === 'high') {
    coverage = shift(COVERAGE_ORDER, coverage, +1)
    amplification = shift(AMP_ORDER, amplification, +1)
    reasons.push('High course depth — raised coverage and enrichment.')
  }

  if (signals.learningPurpose === 'researcher') {
    amplification = shift(AMP_ORDER, amplification, +1)
    reasons.push('Researcher purpose — raised enrichment toward assumptions and derivations.')
  }

  // An explicit student request (captured by the agent) outranks everything derived.
  if (isCoverageLevel(signals.coveragePreference)) {
    coverage = signals.coveragePreference
    reasons.push(`Student explicitly requested ${signals.coveragePreference} coverage.`)
  }

  return {
    coverage,
    presentation,
    amplification,
    key: `${coverage}/${presentation}/${amplification}`,
    reasons,
  }
}

/** Convenience adapter: derive policy directly from a course document. */
export function policyFromCourse(course: any): SourceFidelityPolicy | null {
  return resolveSourceFidelityPolicy({
    mode: course?.mode,
    courseDepth: course?.course_depth,
    learningPurpose: course?.learning_purpose,
    sourceProfile: course?.source_profile ?? null,
    coveragePreference: course?.source_coverage_preference,
  })
}

// ── Lesson-writer directive ───────────────────────────────────────────────────

const COVERAGE_DIRECTIVES: Record<SourceCoverageLevel, string> = {
  complete: `COVERAGE — COMPLETE (nothing may be dropped):
1. EXTRACT: inventory every teaching point in the source material relevant to this page's focus — every concept, definition, reason, argument, list item, step, formula, example, and insight. If the source gives 3 reasons why X beats Y, your inventory has all 3.
2. VERIFY: every inventory item must appear in the finished lesson. Enumerations are sacred — N source reasons/types/steps means N taught, explicitly.
3. COVERED ≠ EXPANDED: cover intelligently, not verbosely. Emphasized concepts get full treatment; minor points get one tight sentence or a row in a compact table; related small points are grouped. Complete coverage must never become page bloat — density rises, page count does not.`,
  smart: `COVERAGE — SMART (substantive points guaranteed, trivia compressible):
1. EXTRACT: inventory the teaching points in the source material relevant to this page's focus.
2. Teach every SUBSTANTIVE point: concepts, definitions, mechanisms, formulas, and anything the source emphasizes or that is plausibly assessable. Explicit enumerations are load-bearing — if the source lists N reasons/types/steps, keep all N.
3. Peripheral detail (asides, repeated remarks, tangents) may be compressed to a brief mention — but compressed means mentioned, not silently dropped. If you fully omit something, it must be genuinely trivial.`,
  core: `COVERAGE — CORE (key concepts deeply, periphery optional):
1. Identify the concepts the source emphasizes and teach those deeply and well.
2. Peripheral source detail may be omitted entirely in favor of depth on what matters.
3. Even here, never drop: enumerations the source presents as important, safety-critical caveats, or anything the source marks as exam-relevant. When you cut, cut the trivial — never the load-bearing.`,
}

const PRESENTATION_DIRECTIVES: Record<SourcePresentation, string> = {
  compact: `PRESENTATION — COMPACT: tight bullets and small tables over flowing prose; one-line treatment for minor points; no narrative padding, transitions, or recaps. A dense half-page beats a comfortable full page.`,
  standard: `PRESENTATION — STANDARD: normal lesson density. Prose where the idea needs a story, bullets where it's list-like.`,
  expansive: `PRESENTATION — EXPANSIVE: emphasized concepts may be treated from multiple angles (intuition AND formalism, mechanism AND consequence). Depth means more angles, never word-padding.`,
}

const AMPLIFICATION_DIRECTIVES: Record<SourceAmplification, string> = {
  light: `AMPLIFICATION — LIGHT: rewrite for clarity, but stay close to the source's framing. Add intuition only where the source is genuinely confusing. No decorative analogies or added context — the student wants the material itself, efficiently.`,
  standard: `AMPLIFICATION — STANDARD: rewrite the source's explanations to be clearer than the original. Add intuition, an analogy, or a real-world example where the source is weak, and repair obvious gaps (an unstated assumption, a formula without intuition).`,
  rich: `AMPLIFICATION — RICH: actively engineer better understanding than the source provides. Hunt for its weaknesses — unstated assumptions, definitions without practical meaning, formulas without intuition, weak examples, abrupt transitions, claims without why they matter — and explicitly repair each one. Add real-world examples, analogies, and context generously. This is why the student uploaded sources: amplification, not restatement.`,
}

const SCOPE_BOUNDARY = `SCOPE BOUNDARY (applies at every level):
- The sources define the subject-matter scope. Do not introduce new subject concepts, methods, or syllabus material the sources never teach — enrichment deepens THEIR content; it never extends the syllabus.
- Teach in the source's terminology and notation. Prefer its examples; add your own alongside them, not instead of them.
- If the source covers this focus thinly, teach what it teaches, then close with one line noting the boundary (e.g. "Your material stops here — it doesn't go deeper into X."). Never pad with new subject matter.
- If retrieved excerpts are about other topics, ignore them rather than force-fitting.`

/** The source-grounded block for the lesson writer, scaled to the policy. */
export function buildLessonFidelityDirective(policy: SourceFidelityPolicy): string {
  return [
    `The sources define WHAT this page teaches; this policy defines how much and how densely. Current fidelity policy: coverage=${policy.coverage}, presentation=${policy.presentation}, amplification=${policy.amplification}.`,
    '',
    COVERAGE_DIRECTIVES[policy.coverage],
    '',
    PRESENTATION_DIRECTIVES[policy.presentation],
    '',
    AMPLIFICATION_DIRECTIVES[policy.amplification],
    '',
    SCOPE_BOUNDARY,
  ].join('\n')
}

// ── Topic-planner directive ───────────────────────────────────────────────────

const PLAN_DIRECTIVES: Record<SourceCoverageLevel, string> = {
  complete: `- Coverage policy is COMPLETE: distribute EVERY teaching point of this topic's source material across the page focuses so nothing is orphaned. Consolidate by making pages denser, never by dropping content — prefer fewer, denser pages over many thin ones.`,
  smart: `- Coverage policy is SMART: every substantive teaching point of the source material must land in some page's focus; trivial asides need no dedicated focus. When merging draft focuses, merge their content — don't lose it.`,
  core: `- Coverage policy is CORE: plan pages around the concepts the source emphasizes; peripheral source detail needs no page. Fewer, deeper pages are the goal.`,
}

/** The source-coverage block for the topic-level lesson planner. */
export function buildPlanFidelityDirective(policy: SourceFidelityPolicy): string {
  return [
    `SOURCE-BASED COURSE — coverage discipline (policy: ${policy.key}):`,
    `- This topic teaches the student's uploaded material (see the source excerpts in retrieved course memory).`,
    PLAN_DIRECTIVES[policy.coverage],
    `- Sequence the pages to follow the source's own progression unless it has a clear pedagogical flaw.`,
  ].join('\n')
}

// ── Curriculum-builder note ───────────────────────────────────────────────────

const CURRICULUM_NOTES: Record<SourceCoverageLevel, string> = {
  complete: `- COVERAGE STANCE (complete): every concept the sources teach must be reachable from some topic's scope — nothing examinable may fall between topics. Keep the roadmap small via richer topics with more pages, never by dropping covered concepts.`,
  smart: `- COVERAGE STANCE (smart): every substantive concept the sources teach belongs in some topic's scope; passing mentions and asides do not need topic-level representation.`,
  core: `- COVERAGE STANCE (core): organize the roadmap around the concepts the sources emphasize; peripheral material may be folded into parent topics rather than represented separately.`,
}

/** One-line coverage stance for the curriculum builder's source rules. */
export function buildCurriculumFidelityNote(policy: SourceFidelityPolicy | null): string {
  if (!policy) return ''
  return CURRICULUM_NOTES[policy.coverage]
}
