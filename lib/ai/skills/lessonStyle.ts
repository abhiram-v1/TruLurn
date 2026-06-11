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
  // ── Personal teaching styles (user-selectable) ──
  | 'first_principles'      // Derive everything from axioms the student already accepts
  | 'visual_analogy'        // Mental pictures and analogies carry the teaching
  | 'socratic'              // Guided questions the student answers before the reveal
  | 'project_based'         // Concepts taught inside a running build
  | 'exam_oriented'         // Optimized for test performance and scoring patterns
  | 'concise_speed'         // Maximum signal, minimum words — for fast movers
  | 'deep_conceptual'       // Slow, thorough, multiple angles per concept

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
  first_principles: {
    name: 'First Principles',
    description: 'Every concept is rebuilt from things you already accept as true. No formula or rule arrives without its derivation from the ground up.',
  },
  visual_analogy: {
    name: 'Visual & Analogy Driven',
    description: 'Mental pictures first. Every abstract idea gets a concrete analogy or visual scene before any formal treatment.',
  },
  socratic: {
    name: 'Socratic Questioning',
    description: 'Lessons teach by asking. You reason through guided questions before the answer is revealed, so understanding is earned, not given.',
  },
  project_based: {
    name: 'Practical & Project-Based',
    description: 'Concepts are taught inside a running project. You learn each idea at the moment the build needs it.',
  },
  exam_oriented: {
    name: 'Exam-Oriented',
    description: 'Optimized for test performance: definitions in markable form, solved problems in exam format, common traps and scoring patterns.',
  },
  concise_speed: {
    name: 'Concise & High-Speed',
    description: 'Maximum signal, minimum words. Compressed explanations for fast movers who fill gaps themselves.',
  },
  deep_conceptual: {
    name: 'Deep Conceptual Learning',
    description: 'Slow and thorough. Each concept from multiple angles — intuition, formalism, edge cases, connections — until it is genuinely owned.',
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

  first_principles: `LESSON STYLE — First Principles (bias strength 6-7/10 — use your own judgment to deviate when a specific concept genuinely calls for a different approach):
Primary medium: derivation from foundations the student already accepts.
- Open by identifying the smallest set of facts/axioms this concept rests on — name them explicitly
- Build the concept step by step FROM those foundations; every step must follow from the previous one with no leaps
- Never present a formula, rule, or convention as given — show why it must be that way, or say honestly that it is a convention
- When a standard explanation hides an assumption, surface the assumption and test it
- Prefer "what would happen if we didn't have X?" reasoning to motivate why X exists
- Anchor each derivation's conclusion back to the practical idea it produces
- Do not skip a derivation step because it seems obvious — obvious steps are where first-principles understanding silently breaks`,

  visual_analogy: `LESSON STYLE — Visual & Analogy Driven (bias strength 6-7/10 — use your own judgment to deviate when a specific concept genuinely calls for a different approach):
Primary medium: mental pictures, analogies, and spatial/visual descriptions.
- Every abstract concept gets a concrete analogy or visual scene BEFORE any formal treatment
- Choose analogies from everyday physical experience (nature, motion, containers, maps, machines) and reuse a good analogy across pages so the mental model compounds
- Describe what things would LOOK like: shapes, flows, sizes, directions — write so the student can sketch it
- When notation is necessary, map each symbol back to its place in the picture ("$w$ is the knob you turn")
- Tables and structured comparisons are visual tools — use them for contrasts
- State each analogy's breaking point: where the picture stops matching reality
- Do not stack two different analogies for the same concept on one page — one strong picture beats two weak ones`,

  socratic: `LESSON STYLE — Socratic Questioning (bias strength 6-7/10 — use your own judgment to deviate when a specific concept genuinely calls for a different approach):
Primary medium: guided questions the student reasons through before answers are revealed.
- Teach through question sequences: pose a question, leave thinking space, then walk through the reasoning to the answer
- Open each concept with the puzzle it solves, phrased as a question the student can attack with what they already know
- After establishing something, immediately ask the next natural question ("So if that's true, what happens when…?")
- Wrong-but-tempting answers are teaching material: pose them, let the student feel the pull, then dismantle them
- Use "Think before you read on:" markers before reveals, and blockquote hints rather than instant answers
- Checkpoints sections fit this style on most pages — they ARE the style
- Do not turn every sentence into a question — rhetorical question spam is noise. Each question must genuinely advance the reasoning chain`,

  project_based: `LESSON STYLE — Practical & Project-Based (bias strength 6-7/10 — use your own judgment to deviate when a specific concept genuinely calls for a different approach):
Primary medium: a running build the concepts serve.
- Frame the topic's pages around a small, concrete, realistic project thread; introduce each concept at the exact moment the build needs it
- Open pages with the build problem at hand ("our model trains but the loss explodes — here's why"), not with definitions
- Every concept must answer "what does this let me build or fix?" — if it doesn't change what the student does, compress it
- Show real artifacts: code, configs, schemas, sketches of the thing being built — with realistic names and data
- End pages with the next concrete build step or a small hands-on task the student can actually do
- Theory appears just-in-time and just-enough — link forward ("we'll need the math when we tune it")
- Do not abandon the project thread for a page of pure theory; weave the theory into the build's needs`,

  exam_oriented: `LESSON STYLE — Exam-Oriented (bias strength 6-7/10 — use your own judgment to deviate when a specific concept genuinely calls for a different approach):
Primary medium: exam-format mastery — definitions in markable form, solved problems, traps.
- Present each definition/theorem in the precise, compact form an examiner expects to see reproduced
- Include at least one fully worked, exam-style problem per substantial concept — numbered steps, marks-worthy structure
- Call out the standard question patterns for this concept ("this is usually asked as: derive X / compare X and Y / find the error")
- Name the classic traps and lost-marks mistakes explicitly, and how to avoid them
- Mnemonic structures, compact comparison tables, and "must-write keywords" lists are first-class content
- Time-efficiency matters: show the fast correct method, then mention the slow one only if it builds understanding
- Misconceptions and checkpoints sections earn their place on most pages in this style
- Do not pad with material that cannot plausibly be examined — exam relevance is the filter`,

  concise_speed: `LESSON STYLE — Concise & High-Speed (bias strength 6-7/10 — use your own judgment to deviate when a specific concept genuinely calls for a different approach):
Primary medium: compressed, high-density explanation for a fast mover.
- Target roughly half the words of a normal page; every sentence must carry new information
- Lead with the sharpest one-line statement of the concept, then only the detail that prevents misuse
- Prefer tight bullets and compact tables over flowing prose; cut transitions, recaps, and motivational framing
- One example maximum per concept, chosen for maximum coverage — no example variations
- Skip what a smart reader can infer; explicitly flag only the genuinely non-obvious ("counterintuitive: …")
- Keep precision while compressing — terse must never become vague or wrong
- estimated_length should lean "short"; a dense half-page beats a comfortable full page
- Do not compress safety-critical caveats or the single key insight — those keep full weight`,

  deep_conceptual: `LESSON STYLE — Deep Conceptual Learning (bias strength 6-7/10 — use your own judgment to deviate when a specific concept genuinely calls for a different approach):
Primary medium: thorough multi-angle treatment until the concept is owned, not borrowed.
- Approach each significant concept from at least two angles: intuition AND formalism, or mechanism AND consequence
- Always answer "why is it this way and not the obvious alternative?" — contrast with the naive design that doesn't work
- Surface the boundaries: where the concept stops applying, edge cases, and what breaks when assumptions fail
- Connect explicitly to neighboring concepts the student has seen — understanding is the connections
- Worked examples should expose the concept's behavior, not just its procedure (show WHY each step changes what it changes)
- Misconceptions, key_ideas, and checkpoints sections all fit naturally here when the page is substantial
- Re-state the core insight in different words at the close — one compression after the full treatment
- Do not rush; depth is the point. But depth means more angles and connections, never word-padding`,
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
