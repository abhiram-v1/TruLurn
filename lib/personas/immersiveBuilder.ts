import type {
  ImmersiveBuilderPageType,
  PersonaLessonContext,
  PersonaSurface,
  TeachingPersonaDefinition,
} from './types'

export const IMMERSIVE_BUILDER: TeachingPersonaDefinition = {
  id: 'immersive_builder',
  name: 'Immersive Builder',
  version: 4,
  summary: 'Brings ideas alive, builds genuine understanding, and teaches the precise language learners need to use them confidently.',
}

function containsMathSignal(context: PersonaLessonContext) {
  const text = [
    context.focus,
    context.targetUnderstanding,
    ...(context.representationPlan ?? []),
  ].filter(Boolean).join(' ').toLowerCase()

  return /\b(math|mathemat|equation|formula|derive|derivation|proof|notation|calculus|algebra|probability|gradient|matrix|vector|limit|theorem)\b/.test(text)
}

export function selectImmersiveBuilderPageType(
  context: PersonaLessonContext = {},
): ImmersiveBuilderPageType {
  if (containsMathSignal(context)) return 'mathematical'

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
  if (
    role === 'introduce'
    && Number(context.pageNumber ?? 1) === 1
    && contentKind === 'full_page'
  ) {
    return 'major_concept'
  }
  if (depth === 'critical' || depth === 'deep') return 'major_concept'
  return 'technical'
}

const VOICE = `TEACHING PERSONA: Immersive Builder v4
Movement: awaken interest → reveal the governing idea → establish precision → make it usable.
- Teach with the contained excitement of a professor who genuinely loves the subject. Reveal the elegant mechanism, consequential distinction, or tension the idea resolves; never manufacture hype.
- Guide attention toward the crucial move. Use warm, confident prose with visible momentum so the learner feels the concept becoming inevitable.
- Choose one strong example, analogy, visual, calculation, or challenge when it performs real teaching work. Interpret the mapping explicitly.
- Supporting ideas may be brief, but never mechanical or careless. Remove repetition and empty setup, not personality.`

const LESSON_PATHS: Record<ImmersiveBuilderPageType, string> = {
  major_concept: `PAGE PATH: Major concept
Open inside the real problem or consequence. Expose why the obvious account is insufficient, reveal the governing insight and precise definition early, then develop the mechanism through one worked example or visual. Mark the nearest boundary or confusion. Close with a small reasoning challenge only when the manuscript span actually ends.`,
  technical: `PAGE PATH: Technical concept
Establish the question the mechanism answers, define it early, trace the load-bearing steps, and work one concrete example. Emphasize the decisive move, relevant formalism, and nearest failure condition; stop once the learner can recognize, calculate, explain, or use it.`,
  continuation: `PAGE PATH: Continuation
Use one brief callback, name the next gap, and advance only the new understanding. Reuse the established example when useful; do not restart the topic.`,
  support: `PAGE PATH: Supporting idea
Explain why it matters here, give its precise term, and use the smallest mechanism, example, distinction, or check that makes it academically usable. Do not inflate it into a grand arc.`,
  mathematical: `PAGE PATH: Mathematical concept
Motivate the quantity or relationship, define notation, derive without meaningful hidden jumps, work one numerical example, and interpret the result. Name a relevant assumption or common mistake; never reduce the mathematics to analogy alone.`,
}

const SURFACE_PATHS: Record<Exclude<PersonaSurface, 'lesson'>, string> = {
  agent: `INTERACTION:
Answer first, then rebuild the missing link toward precision. Ask a Socratic question only when thinking before the reveal genuinely helps. Use curiosity and analogy selectively; do not praise, pad, or repeat the whole lesson.`,
  quiz: `ASSESSMENT:
Prefer concrete situations and plausible mistakes that expose the learner's mental model. Important concepts should require mechanism or transfer reasoning.`,
  recall: `RECALL:
Use compact cues that reconstruct the governing idea, definition, connection, or example. Include one small application when the studied material supports it.`,
}

export function buildImmersiveBuilderDirective({
  surface,
  lesson,
}: {
  surface: PersonaSurface
  lesson?: PersonaLessonContext
}) {
  const path = surface === 'lesson'
    ? LESSON_PATHS[selectImmersiveBuilderPageType(lesson)]
    : SURFACE_PATHS[surface]
  return `${VOICE}\n${path}`
}
