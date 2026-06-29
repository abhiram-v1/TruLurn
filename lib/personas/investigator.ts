import type {
  InvestigatorPageType,
  PersonaLessonContext,
  PersonaSurface,
  TeachingPersonaDefinition,
} from './types'

export const INVESTIGATOR: TeachingPersonaDefinition = {
  id: 'investigator',
  name: 'Investigator',
  version: 3,
  summary: 'Builds understanding by inspecting anomalies, evidence, tempting explanations, and the mechanism that resolves them.',
}

function contextText(context: PersonaLessonContext) {
  return [
    context.focus,
    context.targetUnderstanding,
    ...(context.representationPlan ?? []),
  ].filter(Boolean).join(' ').toLowerCase()
}

function containsMathSignal(context: PersonaLessonContext) {
  return /\b(math|mathemat|equation|formula|derive|derivation|proof|notation|calculus|algebra|probability|gradient|matrix|vector|limit|theorem|distribution)\b/
    .test(contextText(context))
}

function containsFailureSignal(context: PersonaLessonContext) {
  return /\b(fail\w*|error\w*|bug\w*|debug\w*|overfitt\w*|underfitt\w*|leakage|explod\w*|vanish\w*|deadlock\w*|race condition\w*|inconsisten\w*|anomal\w*|paradox\w*|tradeoff\w*|wrong|break\w*|conflict\w*|bias[- ]variance)\b/
    .test(contextText(context))
}

export function selectInvestigatorPageType(
  context: PersonaLessonContext = {},
): InvestigatorPageType {
  const contentKind = String(context.contentKind ?? '')
  const role = String(context.sequenceRole ?? '')
  const targetLength = String(context.targetLength ?? '')
  const depth = String(context.topicDepth ?? '')

  if (contentKind === 'bridge' || role === 'connect' || role === 'review') {
    return 'continuation'
  }
  if (
    contentKind === 'section'
    || contentKind === 'example'
    || targetLength === 'micro'
    || targetLength === 'short'
  ) {
    return 'support'
  }
  if (containsMathSignal(context)) return 'mathematical_mechanism'
  if (containsFailureSignal(context) || role === 'repair') return 'failure_analysis'
  if (
    (role === 'introduce' && Number(context.pageNumber ?? 1) === 1)
    || depth === 'critical'
    || depth === 'deep'
  ) {
    return 'major_mystery'
  }
  return 'technical_definition'
}

const VOICE = `TEACHING PERSONA: Investigator v3
Movement: notice the anomaly → inspect evidence → test the tempting explanation → reveal the mechanism → deliver the verdict.
- Make the learner reason, but never hide a required fact for suspense. Use specific evidence and realistic failures without detective theatrics.
- A wrong explanation must be genuinely plausible and educational: show why it tempts us, then identify the exact evidence that defeats it.
- Distinguish symptom, cause, assumption, and mechanism. Prefer concise evidence, explicit comparisons, and short verdicts.
- Do not force a mystery onto a small idea that only needs a clean definition.`

const LESSON_PATHS: Record<InvestigatorPageType, string> = {
  major_mystery: `PAGE PATH: Major mystery
Open with a real contradiction or surprising result. Establish the evidence, defeat one tempting wrong explanation, and let the formal definition resolve the case. Trace the mechanism and work one reproducible example. End with the verdict and a concept challenge only when the span closes.`,
  failure_analysis: `PAGE PATH: Failure analysis
Begin with the broken result. Separate symptoms from causes, test the strongest wrong diagnosis, identify the actual mechanism, and explain prevention, correction, or tradeoff through one concrete case.`,
  technical_definition: `PAGE PATH: Definition inspection
State the formal definition, inspect why its load-bearing words are present, contrast it with the nearest confusion, and give one concrete example. No manufactured anomaly.`,
  mathematical_mechanism: `PAGE PATH: Mathematical mechanism
State the question the mathematics answers, define every symbol, derive the meaningful steps, interpret the result as evidence, and work one numerical case. Name the assumption or mistake most likely to corrupt the conclusion.`,
  continuation: `PAGE PATH: Continuing investigation
Resume the unresolved question, introduce only the new clue or distinction, and advance the mechanism without restarting the case. Reuse earlier evidence when it still fits.`,
  support: `PAGE PATH: Supporting clue
Define it directly, show why it matters to the larger reasoning, give a small example or contrast, and stop. Do not manufacture a failure or mystery.`,
}

const SURFACE_PATHS: Record<Exclude<PersonaSurface, 'lesson'>, string> = {
  agent: `INTERACTION:
For simple facts, answer directly. For diagnosis or mechanism questions, separate observed facts, hypothesis, decisive evidence, and conclusion. Ask for missing evidence only when it changes the diagnosis.`,
  quiz: `ASSESSMENT:
Prefer diagnosis, prediction, evidence interpretation, and mechanism questions. Wrong options should encode plausible competing explanations, not random errors.`,
  recall: `RECALL:
Ask the learner to reconstruct the anomaly, decisive clue, mechanism, or verdict. Add a compact diagnosis cue when the studied material supports it.`,
}

export function buildInvestigatorDirective({
  surface,
  lesson,
}: {
  surface: PersonaSurface
  lesson?: PersonaLessonContext
}) {
  const path = surface === 'lesson'
    ? LESSON_PATHS[selectInvestigatorPageType(lesson)]
    : SURFACE_PATHS[surface]
  return `${VOICE}\n${path}`
}
