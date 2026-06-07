import { generateWithGemini } from '@/lib/ai/gemini/client'
import { parseGeminiJson } from '@/lib/ai/gemini/json'

// ── Type ──────────────────────────────────────────────────────────────────────

export type LessonStyle =
  | 'formal_technical'      // Math, proofs, derivations as primary medium
  | 'code_first'            // Working code carries the explanation
  | 'conceptual_technical'  // Intuition + formalism, neither alone
  | 'applied_professional'  // Scenarios, decisions, real-world framing
  | 'explanatory_narrative' // Argument, narrative, prose — no formalism
  | 'procedural_reference'  // Steps, sequences, conditions, checklists

// ── Catalog ───────────────────────────────────────────────────────────────────
// Human-readable names and short descriptions used by both the selector
// and the agent-side resolver when the user requests a style change.

export const STYLE_CATALOG: Record<LessonStyle, { name: string; description: string }> = {
  formal_technical: {
    name: 'Formal & Technical',
    description: 'Derivations and proofs are the primary teaching instrument. Math formalism explains; intuition accompanies it.',
  },
  code_first: {
    name: 'Code-First Engineering',
    description: 'Working code is the primary medium. Concepts emerge from code, not from definitions that precede it.',
  },
  conceptual_technical: {
    name: 'Conceptual & Technical',
    description: 'Mental model and intuition first, then formalization. Both code and math belong — neither alone is enough.',
  },
  applied_professional: {
    name: 'Applied & Professional',
    description: 'Every concept is framed as a decision, tradeoff, or action. Real-world scenarios over formal definitions.',
  },
  explanatory_narrative: {
    name: 'Explanatory & Narrative',
    description: 'Ideas unfold through argument, analogy, and cause-effect chains. Clear prose; no formalism or code.',
  },
  procedural_reference: {
    name: 'Procedural & Reference',
    description: 'Steps, decision points, and conditions are first-class content. When-to-use-what matters as much as how.',
  },
}

// ── Style directives ──────────────────────────────────────────────────────────
// Each directive is a 6-7/10 bias injected into the page generation prompt.
// The instruction explicitly tells the AI to use its own judgment to deviate
// when the specific concept genuinely calls for a different approach.

const STYLE_DIRECTIVES: Record<LessonStyle, string> = {
  formal_technical: `LESSON STYLE — Formal & Technical (bias strength 6-7/10 — use your own judgment to deviate when a specific concept genuinely calls for a different approach):
Primary medium: mathematical formalism. Derivations and proofs carry the teaching weight.
- Use standalone $$...$$ display equation blocks for all significant formulas and derivations
- Never put prose on the same line as $$, and never place two display-math fences on the same line
- Let the mathematical structure explain the concept — analogies support it, not replace it
- Include the derivation of key formulas when it reveals why the formula takes the form it does
- Introduce notation carefully; reuse it consistently across the page
- Worked problems with full mathematical treatment are the preferred example format
- Code is appropriate only when the concept is inherently computational
- Do not convert a mathematical concept into loose prose when the equation is cleaner and more precise`,

  code_first: `LESSON STYLE — Code-First Engineering (bias strength 6-7/10 — use your own judgment to deviate when a specific concept genuinely calls for a different approach):
Primary medium: working, runnable code. Code carries the explanation — it is not decoration.
- Every abstract claim should be followed immediately by code that demonstrates it
- Concepts emerge from looking at code, then being named and explained — not the reverse
- Use real, concrete code: actual variable names, realistic data, genuine patterns rather than toy examples
- Pseudocode is rarely appropriate — use real language syntax
- Prose explains what the code is doing and why it's structured that way
- Mathematical notation is minimal — only when it adds something code cannot
- Do not explain a programming concept entirely in prose when a concrete 10-20 line example would teach it directly`,

  conceptual_technical: `LESSON STYLE — Conceptual & Technical (bias strength 6-7/10 — use your own judgment to deviate when a specific concept genuinely calls for a different approach):
Primary medium: both intuition and formalism — neither alone is sufficient.
- Lead every concept with a mental model, analogy, or plain-language explanation of why it exists
- Then formalize: introduce the equation, notation, or rigorous definition after the intuition is in place
- Both code examples and mathematical treatment belong on pages where both illuminate something
- The student needs to understand the picture before the symbol, and also understand the symbol
- Misconceptions sections are especially valuable here — this category produces the most false confidence
- Do not stay purely intuitive (hand-wavy) and do not stay purely formal (opaque) — each alone leaves gaps`,

  applied_professional: `LESSON STYLE — Applied & Professional (bias strength 6-7/10 — use your own judgment to deviate when a specific concept genuinely calls for a different approach):
Primary medium: real-world scenarios, decisions, and tradeoffs.
- Every concept earns its place by changing what a practitioner would actually do or decide
- Frame concepts as decisions, tradeoffs, or actions — not as academic definitions followed by examples
- Examples are scenarios with stakes: given a real situation, what do you do and why?
- Comparisons between approaches (when to use A vs B) are often more valuable than complete definitions
- "In practice" and "common mistake" are recurring elements — lean into them
- Theory is minimal — only enough to make the concept transferable and defensible in conversation
- Do not open a page with a formal definition when opening with a recognisable situation teaches faster`,

  explanatory_narrative: `LESSON STYLE — Explanatory & Narrative (bias strength 6-7/10 — use your own judgment to deviate when a specific concept genuinely calls for a different approach):
Primary medium: clear, well-structured prose. Ideas unfold through argument and cause-effect chains.
- Lead with the question or problem the concept answers — build the answer as a logical argument
- Analogies and comparisons between ideas are the primary teaching tools
- Use historical context, case studies, or thought experiments as examples
- Write for understanding, not just description — the reader should feel why each step follows the last
- Short sentences, active voice; no passive constructions where avoidable
- No equations, no code unless a short snippet is the clearest way to illustrate one specific point
- Do not list properties without building the conceptual story that makes them meaningful`,

  procedural_reference: `LESSON STYLE — Procedural & Reference (bias strength 6-7/10 — use your own judgment to deviate when a specific concept genuinely calls for a different approach):
Primary medium: numbered steps, decision conditions, and structured sequences.
- The student is learning a process they will execute — structure it that way from the start
- "When to do X" is as important as "how to do X" — conditions and decision points are first-class content
- Examples are complete procedural walkthroughs from start to finish, not partial illustrations
- Use numbered lists for ordered steps; use conditional notes for branching paths
- Checkpoints sections are standard on procedural pages — active self-testing prevents procedural mistakes
- Do not describe a procedure entirely in prose when numbered steps would be clearer and safer to follow`,
}

export function buildStyleDirective(style: LessonStyle | null | undefined): string {
  if (!style || !STYLE_DIRECTIVES[style]) return ''
  return STYLE_DIRECTIVES[style]
}

// ── Selector — called once at course creation ─────────────────────────────────

export async function determineLessonStyle(
  goals: string,
  courseTitle: string,
  branchTitles: string[],
): Promise<{ style: LessonStyle; reason: string }> {
  const styleList = (Object.entries(STYLE_CATALOG) as [LessonStyle, typeof STYLE_CATALOG[LessonStyle]][])
    .map(([id, info]) => `${id}: ${info.description}`)
    .join('\n')

  const system = `You are a pedagogy classifier. Given a student's learning goal and a course outline, select the single best teaching style for the lesson pages in this course.

Available styles:
${styleList}

Return ONLY valid JSON: { "style": "<style_id>", "reason": "<one sentence explaining the match>" }`

  const user = `Goal: ${goals || 'Learn the subject clearly enough to explain and apply it.'}
Course title: ${courseTitle}
Branches: ${branchTitles.slice(0, 6).join(', ') || 'Not available'}`

  try {
    const raw = await generateWithGemini({
      system,
      user,
      purpose: 'agent',
      responseMimeType: 'application/json',
    })
    const parsed = parseGeminiJson<{ style?: string; reason?: string }>(raw)
    const style = parsed.style as LessonStyle
    if (style && STYLE_DIRECTIVES[style]) {
      return { style, reason: parsed.reason ?? '' }
    }
  } catch {
    // fall through to default
  }

  return { style: 'conceptual_technical', reason: 'Default balanced style — could not determine from goals.' }
}

// ── Resolver — called by the agent when the user requests a style change ──────

export async function resolveStyleFromMessage(message: string): Promise<LessonStyle | null> {
  const styleList = (Object.entries(STYLE_CATALOG) as [LessonStyle, typeof STYLE_CATALOG[LessonStyle]][])
    .map(([id, info]) => `${id} — ${info.name}: ${info.description}`)
    .join('\n')

  const system = `You match a student's request to the best teaching style from the list below.
Return ONLY the style id (e.g. "code_first"). Return "unknown" if no style is a reasonable match.

Styles:
${styleList}`

  try {
    const raw = await generateWithGemini({
      system,
      user: `Student request: "${message}"`,
      purpose: 'agent',
      responseMimeType: 'text/plain',
    })
    const id = raw.trim().replace(/[^a-z_]/g, '') as LessonStyle
    if (id && STYLE_DIRECTIVES[id]) return id
  } catch {
    // fall through
  }

  return null
}
