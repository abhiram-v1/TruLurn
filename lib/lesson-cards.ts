export const SANCTIONED_LESSON_CALLOUTS = {
  Definition: 'definition',
  Example: 'example',
  'Lock this in': 'insight',
} as const

export type LessonCalloutType = typeof SANCTIONED_LESSON_CALLOUTS[keyof typeof SANCTIONED_LESSON_CALLOUTS]

const LEGACY_CALLOUTS: Record<string, LessonCalloutType> = {
  'formal definition': 'definition',
  'worked example': 'example',
  'key insight': 'insight',
  'key idea': 'insight',
  'mental model': 'insight',
  'concept connection': 'insight',
  distinction: 'insight',
  'operational rule': 'insight',
  remember: 'insight',
  tldr: 'insight',
}

function normalizeLabel(label: string) {
  return label
    .toLowerCase()
    .replace(/[.:;!?]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const SANCTIONED_BY_NORMALIZED_LABEL = new Map<string, LessonCalloutType>(
  Object.entries(SANCTIONED_LESSON_CALLOUTS).map(([label, type]) => [normalizeLabel(label), type]),
)

/**
 * The renderer keeps old stored lessons readable, but new generation is held to
 * the three canonical labels through `findUnsupportedLessonCallouts`.
 */
export function classifyLessonCalloutLabel(
  label: string,
  options: { allowLegacy?: boolean } = {},
): LessonCalloutType | null {
  const normalized = normalizeLabel(label)
  const sanctioned = SANCTIONED_BY_NORMALIZED_LABEL.get(normalized)
  if (sanctioned) return sanctioned
  if (options.allowLegacy !== false) return LEGACY_CALLOUTS[normalized] ?? null
  return null
}

export function findLessonCalloutLabels(markdown: string) {
  const labels: string[] = []
  const pattern = /(?:^|\n)\s*>\s*\*\*([^*\r\n]{1,48}?):\*\*/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(markdown))) labels.push(match[1].trim())
  return labels
}

export function findUnsupportedLessonCallouts(markdown: string) {
  return findLessonCalloutLabels(markdown).filter(
    (label) => !classifyLessonCalloutLabel(label, { allowLegacy: false }),
  )
}

export function hasInventedLessonCardContainer(markdown: string) {
  return /(?:^|\n)\s*:::\s*[a-z][\w-]*/i.test(markdown)
    || /<(?:aside|section|div)\b[^>]*(?:class|style)\s*=/i.test(markdown)
}

export function findUnlabelledCodeFences(markdown: string) {
  let insideFence = false
  let unlabelled = 0
  for (const line of markdown.split(/\r?\n/)) {
    const fence = line.match(/^\s*```([^`]*)$/)
    if (!fence) continue
    if (!insideFence && !fence[1].trim()) unlabelled += 1
    insideFence = !insideFence
  }
  return unlabelled
}

export const SANCTIONED_LESSON_CARD_DIRECTIVE = `SANCTIONED LESSON CARDS:
- The renderer owns the card UI. You may request only these exact Markdown forms; never invent a card name, color, icon, wrapper, or HTML component.
- Definition card: \`> **Definition:** ...\` Use only for a precise canonical definition. Put explanation and consequences in normal prose after it.
- Example card: \`> **Example:** ...\` Use only for one concrete worked case that exposes the mechanism. Include the inputs or situation, the important steps, and what the result means.
- Code card: use a fenced code block with an explicit language such as \`\`\`python\`. Introduce why the code matters in prose, keep the snippet focused and runnable, then interpret the important line or output. Never wrap code in a blockquote.
- Lock-in card: \`> **Lock this in:** ...\` Use at most once, only for a planner-required durable relationship, distinction, operational rule, or a genuinely load-bearing closing idea. State the claim directly; include the mapping and its boundary when relevant.
- Cards emphasize teaching payload; they are not section containers. Most pages need one or two cards, and a page does not need every type.
- Keep formulas inside cards in inline \`$...$\` form. Put display equations and multi-line derivations in the normal lesson flow immediately after the card so the Markdown renderer never exposes raw math fences inside a blockquote.
- No other bold-label blockquotes are allowed. Do not emit Remember, TL;DR, Key insight, Key idea, Mental model, Note, Tip, Warning, Concept connection, Distinction, Operational rule, custom ::: containers, raw HTML/MDX cards, colored panels, or decorative callouts.`
