// Pure functions for classifying assessment gaps and preventing regeneration loops.
// No DB calls — all functions operate only on the data passed in.

export type GapType =
  | 'concept_gap'        // Core concept is not understood
  | 'prerequisite_gap'   // Missing foundation is causing confusion
  | 'application_gap'    // Can describe but cannot apply
  | 'false_confidence'   // Confident but systematically wrong

export type TeachingAction =
  | 'explain_again'        // Different angle, same concept
  | 'simplify'             // Reduce complexity, more analogy
  | 'show_example'         // More concrete worked examples
  | 'contrasting_example'  // Show what the concept is NOT (clears false confidence)
  | 'repair_prerequisite'  // Address the missing foundation first
  | 'schedule_recall'      // No regen needed — spaced repetition will consolidate
  | 'continue'             // Gap is within acceptable range

export type RegenerationAttempt = {
  approach: string
  at: string              // ISO timestamp
  succeeded: boolean | null // null = outcome not yet measured
}

export type GapAnalysis = {
  hasGap: boolean
  gapType: GapType | null
  action: TeachingAction
  reason: string
  confidence: number        // 0–1
  affectedConcepts: string[]
  misconceptions: string[]
}

// After this many failed regeneration attempts with the same approach,
// stop looping and recommend a different intervention (break, quiz, prereq repair).
const LOOP_THRESHOLD = 3

// When one approach fails, rotate to the next in sequence.
const APPROACH_ROTATION: Record<string, TeachingAction> = {
  explain_again: 'simplify',
  simplify: 'show_example',
  show_example: 'contrasting_example',
  contrasting_example: 'repair_prerequisite',
  repair_prerequisite: 'schedule_recall',
}

export function classifyGap(
  skillStates: Array<{ effective_mastery?: number; alpha?: number; beta?: number; state?: string; concept?: string }>,
  misconceptionStates: Array<{ misconception?: string }>,
  conceptStates: Array<{ stage?: string; concept?: string; role?: string }>,
): GapAnalysis {
  if (!skillStates.length && !conceptStates.length) {
    return {
      hasGap: false,
      gapType: null,
      action: 'continue',
      reason: 'No assessment evidence yet.',
      confidence: 0,
      affectedConcepts: [],
      misconceptions: [],
    }
  }

  const misconceptionLabels = misconceptionStates
    .map((m) => m.misconception)
    .filter((m): m is string => Boolean(m))

  // False confidence: high confidence combined with systematically wrong answers.
  // Signal: explicit 'false_confidence' state, or beta (failures) is more than twice alpha (successes)
  // while effective_mastery is still relatively high (the model thought they were doing OK).
  const falseConfidenceSignals = skillStates.filter(
    (s) =>
      s.state === 'false_confidence' ||
      (
        typeof s.alpha === 'number' &&
        typeof s.beta === 'number' &&
        s.beta > s.alpha * 2 &&
        (s.effective_mastery ?? 1) > 0.5
      ),
  )
  if (falseConfidenceSignals.length || misconceptionLabels.length) {
    return {
      hasGap: true,
      gapType: 'false_confidence',
      action: 'contrasting_example',
      reason: misconceptionLabels.length
        ? `Specific misconception detected: "${misconceptionLabels[0]}". The learner is confident but wrong — a contrasting example or explicit boundary will help more than re-explanation.`
        : 'Answers are confident but systematically incorrect. This is a misconception, not a knowledge gap — contrasting examples and boundaries are more effective than re-explaining the concept.',
      confidence: 0.85,
      affectedConcepts: falseConfidenceSignals
        .map((s) => s.concept)
        .filter((c): c is string => Boolean(c)),
      misconceptions: misconceptionLabels,
    }
  }

  // Prerequisite gap: two or more prerequisite concepts are still at recognition level.
  // The learner is missing the foundation this concept builds on.
  const prereqWeak = conceptStates.filter(
    (c) =>
      c.role === 'prerequisite' &&
      (c.stage === 'never_encountered' || c.stage === 'recognizes'),
  )
  if (prereqWeak.length >= 2) {
    return {
      hasGap: true,
      gapType: 'prerequisite_gap',
      action: 'repair_prerequisite',
      reason: 'Multiple prerequisite concepts are at recognition level or below. The foundation needs to be reinforced before this topic will fully land.',
      confidence: 0.8,
      affectedConcepts: prereqWeak.map((c) => c.concept).filter((c): c is string => Boolean(c)),
      misconceptions: [],
    }
  }

  // Application gap: the learner understands conceptually but fails applied questions.
  // Signal: alpha ≥ 1 (at least one success on recognition) but effective_mastery is still low.
  const applicationGapSignals = skillStates.filter(
    (s) =>
      s.state === 'application_gap' ||
      (typeof s.alpha === 'number' && s.alpha >= 1 && (s.effective_mastery ?? 1) < 0.5),
  )
  if (applicationGapSignals.length) {
    return {
      hasGap: true,
      gapType: 'application_gap',
      action: 'show_example',
      reason: 'The learner can describe the concept but cannot apply it. Worked examples with concrete values will close the gap faster than another explanation.',
      confidence: 0.75,
      affectedConcepts: applicationGapSignals
        .map((s) => s.concept)
        .filter((c): c is string => Boolean(c)),
      misconceptions: [],
    }
  }

  // Concept gap: basic comprehension is weak.
  const weakSkills = skillStates.filter((s) => (s.effective_mastery ?? 1) < 0.4)
  if (weakSkills.length) {
    const avgMastery =
      weakSkills.reduce((sum, s) => sum + (s.effective_mastery ?? 0), 0) / weakSkills.length
    const action: TeachingAction = avgMastery < 0.25 ? 'simplify' : 'explain_again'
    return {
      hasGap: true,
      gapType: 'concept_gap',
      action,
      reason:
        avgMastery < 0.25
          ? 'Mastery is very low. A simpler, more accessible explanation with heavy analogy is needed before increasing complexity.'
          : 'The core concept is not landing. A different angle or framing will help more than repeating the current one.',
      confidence: 0.7,
      affectedConcepts: weakSkills.map((s) => s.concept).filter((c): c is string => Boolean(c)),
      misconceptions: [],
    }
  }

  // Performance is acceptable — spaced repetition will consolidate.
  return {
    hasGap: false,
    gapType: null,
    action: 'schedule_recall',
    reason: 'Assessment shows reasonable understanding. Spaced repetition will consolidate what was learned.',
    confidence: 0.6,
    affectedConcepts: [],
    misconceptions: [],
  }
}

// Returns true when further regeneration is unlikely to help.
// Fires when the learner has already received the same approach N times without improvement.
export function shouldCircuitBreak(attempts: RegenerationAttempt[]): boolean {
  if (attempts.length < LOOP_THRESHOLD) return false
  const recent = attempts.slice(-LOOP_THRESHOLD)
  const allSameApproach = recent.every((a) => a.approach === recent[0].approach)
  const noneSucceeded = recent.every((a) => a.succeeded !== true)
  return allSameApproach && noneSucceeded
}

// Returns the next approach to try when the current one has failed.
export function nextApproach(attempts: RegenerationAttempt[]): TeachingAction {
  if (!attempts.length) return 'explain_again'
  const lastApproach = attempts[attempts.length - 1].approach
  return APPROACH_ROTATION[lastApproach] ?? 'simplify'
}

// Message shown to the learner when the loop circuit breaks.
export const CIRCUIT_BREAK_MESSAGE =
  "I've regenerated this page several times and we seem to be going in circles. Rather than another version of the same explanation, here are three things that often work better: take a short break and come back fresh; try the quiz to see exactly which part is tripping you up; or ask me a specific question about the part that is confusing. Sometimes a focused question-and-answer session lands better than another written page."
