# TruLurn — Page Generation Engine

> This document covers the full pipeline for how lesson content is generated, streamed, and kept consistent across an entire course. Read this before touching any generation logic.

---

## Core Idea

The mini roadmap is not a UI component. It is the AI's memory and orientation system. Every page generation call receives the full mini roadmap as context — what has been covered, where the AI is now, and what comes next. Without it every call is blind. With it the entire lesson reads as one coherent explanation from a single teacher.

---

## The Prompt Template

The system prompt is hardcoded. Only the variables change. The AI never deviates from this structure.

```
SYSTEM (never changes):
You are a personal tutor for a [FIELD] student at [LEVEL] level.
Your explanation style is formal, clear, and example-driven.
Never use filler phrases. Never say "great question". Never encourage.
Be direct. Be accurate. Be thorough where it matters.

Your output must follow this structure exactly — no deviations:
- Concept definition (1-2 sentences, precise)
- Intuition (1 paragraph, plain language, no jargon)
- Depth level: [DEPTH] — follow the depth rules below
- Examples: follow the example rules below
- Common misconceptions: flag them if any exist for this topic
- Connection: one sentence linking this to [PREV_SUBTOPIC]

DEPTH RULES (assigned per subtopic at course setup, never changes):
  light     → define and move on. 1 paragraph max. no examples needed.
  medium    → explain the mechanism. 1-2 examples.
  important → explain why it works, not just how. 2-3 examples with variation.
  critical  → full treatment. edge cases. failure modes. 3+ examples.
              never leave a critical topic at surface level.

EXAMPLE RULES:
  - Examples must be concrete, not abstract
  - First example: simplest possible case
  - Second example: realistic use case from [FIELD]
  - Third example (critical only): edge case or common failure

STYLE ANCHOR (generated once at course setup, sent with every call):
[STYLE_PROMPT]
```

```
USER (fills per inference):
Topic: [TOPIC_NAME]
Branch: [BRANCH]
Subtopic: [SUBTOPIC_NAME]
Depth level: [DEPTH]
Page: [PAGE_NUMBER] of this subtopic
Page focus: [PAGE_FOCUS]
Style anchor: [STYLE_PROMPT]

MINI ROADMAP:
[FULL_MINI_ROADMAP_WITH_STATE]
```

---

## The Style Prompt

Generated once at course setup alongside the roadmap. Prepended to every single page generation call as a system-level anchor. Guarantees consistency across every topic, every batch, every session.

### How it is generated

At course setup the AI receives the topic, the student's goals, and their level, and returns a style anchor:

```typescript
// lib/prompts/generateStylePrompt.ts

export function generateStylePromptRequest(
  topic: string,
  goals: string,
  level: string,
  field: string
) {
  return {
    system: `You are a curriculum designer. 
You generate a style anchor — a short instruction set that locks 
explanation consistency across all lesson pages for a course.
Respond ONLY with the style anchor text. No preamble. No JSON.`,

    user: `Course topic: ${topic}
Student level: ${level}
Field: ${field}
Student goals: ${goals}

Write a style anchor (4-6 sentences) that defines:
- Explanation approach (analogies, formal, code-first, visual, etc.)
- Preferred example domain (real-world systems, code, math, etc.)
- What to assume the student already knows
- Paragraph length and density preference
- Any field-specific conventions to follow

This will be prepended to every lesson page generation call.
Be specific. Be prescriptive. This is a hard constraint, not a suggestion.`
  }
}
```

### Example output

```
Explain concepts using intuitive real-world analogies first, 
then formalize with notation. Assume the student knows Python 
and basic calculus but has no ML experience. Use short paragraphs, 
maximum 4 lines each. When introducing a new term, define it in 
the same sentence — never assume the student will look it up. 
Prefer systems-thinking analogies (pipelines, filters, signals) 
over cooking or sports. Code examples in Python using scikit-learn 
conventions where applicable.
```

---

## Depth Classification

At course setup, after the roadmap is generated, every subtopic in every mini roadmap gets assigned a depth level. This runs once. The assignment is permanent unless manually overridden.

### Classification prompt

```typescript
// lib/prompts/classifyDepth.ts

export function classifyDepthRequest(
  topic: string,
  subtopics: string[],
  field: string
) {
  return {
    system: `You are a curriculum designer. 
You assign depth levels to learning subtopics.
Respond ONLY with valid JSON. No preamble.`,

    user: `Topic: ${topic}
Field: ${field}
Subtopics: ${JSON.stringify(subtopics)}

Assign a depth level to each subtopic:
  light     → terminology, definitions, context-setting
  medium    → concepts the student uses but need not master deeply
  important → concepts that recur or are frequently misunderstood
  critical  → foundational mechanisms everything else depends on,
               or topics with high misconception rates

Return:
{
  "subtopic_title": "light" | "medium" | "important" | "critical"
}`
  }
}
```

### Depth → page count mapping

| Depth | Pages generated | Examples |
|---|---|---|
| light | 1–2 | Variable names, what is ML, intro to classification |
| medium | 2–3 | Train/test split, feature scaling, confusion matrix |
| important | 3–5 | Gradient descent, overfitting, cross-validation |
| critical | 5–8 | Backpropagation, loss functions, attention mechanism |

---

## The Mini Roadmap State Object

The mini roadmap is the AI's orientation system. It is a structured object that gets passed with every inference call and updated after every completed subtopic.

### TypeScript type

```typescript
// types/index.ts

export type DepthLevel = 'light' | 'medium' | 'important' | 'critical'

export type SubtopicStatus = 'pending' | 'in_progress' | 'completed'

export interface SubtopicState {
  id: string
  title: string
  depth: DepthLevel
  status: SubtopicStatus
  position: number
  pages_generated: number
  total_pages_planned: number             // set at classification time
  key_concepts_established: string[]      // filled as pages complete
}

export interface MiniRoadmap {
  topic_id: string
  topic_title: string
  branch: string
  field: string
  current_index: number                   // index of active subtopic
  style_prompt: string                    // course-level style anchor
  subtopics: SubtopicState[]
}
```

### Database columns (add to topics table)

```sql
alter table topics add column depth text 
  check (depth in ('light','medium','important','critical'));

alter table topics add column total_pages_planned int default 3;

alter table topics add column key_concepts_established text[] default '{}';
```

---

## The Generation Cycle

### Full cycle diagram

```
[course setup]
    generateRoadmap()         → full branch + topic tree
    generateStylePrompt()     → style anchor, stored on course
    classifyDepth()           → depth assigned to every subtopic
    buildMiniRoadmaps()       → one mini roadmap per main topic

[first topic auto-fires]
    mini roadmap built        → all subtopics pending
    current_index = 0         → first subtopic marked in_progress
    generatePageBatch()       → pages 1-3 of subtopic[0]
    pages stored to DB        → page 1 rendered immediately

[user reads]
    user on page 1            → nothing fires
    user on page 2            → nothing fires
    user on page N-2          → lookahead fires silently
        generatePageBatch()   → next batch of same subtopic
        OR if subtopic ending → generatePageBatch() of next subtopic

[subtopic completes]
    last page read            → subtopic marked completed
    key_concepts stored       → extracted from pages
    current_index advances    → next subtopic marked in_progress
    mini roadmap updates      → YOU ARE HERE moves forward
    updated roadmap ready     → feeds next inference

[quiz passed]
    topic fully completed     → main roadmap state updates
    next main topic unlocked  → first batch pre-generated silently
    user clicks next topic    → pages already waiting
```

### Lookahead trigger logic

```typescript
// lib/generation/lookahead.ts

export function shouldTriggerLookahead(
  currentPage: number,
  totalPagesGenerated: number
): boolean {
  return currentPage >= totalPagesGenerated - 2
}

export function shouldPreGenerateNextTopic(
  quizPassed: boolean,
  nextTopicPagesGenerated: number
): boolean {
  return quizPassed && nextTopicPagesGenerated === 0
}
```

---

## The Page Batch Prompt

What gets sent to the AI on every generation call.

```typescript
// lib/prompts/generatePageBatch.ts

export function buildMiniRoadmapContext(roadmap: MiniRoadmap): string {
  return roadmap.subtopics.map((s, i) => {
    const isCurrent = i === roadmap.current_index
    const status =
      s.status === 'completed' ? '[ ✓ ]' :
      isCurrent               ? '[ → ]' :
                                 '[   ]'
    const concepts = s.key_concepts_established.length > 0
      ? `\n       established: ${s.key_concepts_established.join(', ')}`
      : ''
    return `${status} ${s.title.padEnd(36)} (${s.depth})${concepts}`
  }).join('\n')
}

export function generatePageBatchRequest(
  roadmap: MiniRoadmap,
  pageNumber: number,
  pageFocus: string
): { system: string; user: string } {
  const current = roadmap.subtopics[roadmap.current_index]
  const prev = roadmap.current_index > 0
    ? roadmap.subtopics[roadmap.current_index - 1]
    : null

  return {
    system: `You are a personal tutor for a ${roadmap.field} student.
Your explanation style is formal, clear, and example-driven.
Never use filler phrases. Never say "great question". Never encourage.
Be direct. Be accurate. Be thorough where it matters.

DEPTH RULES:
  light     → define and move on. 1 paragraph max. no examples.
  medium    → explain the mechanism. 1-2 examples.
  important → explain why it works, not just how. 2-3 examples.
  critical  → full treatment. edge cases. failure modes. 3+ examples.

EXAMPLE RULES:
  - First example: simplest possible case
  - Second example: realistic use case from ${roadmap.field}
  - Third example (critical only): edge case or failure mode

STYLE ANCHOR:
${roadmap.style_prompt}`,

    user: `MINI ROADMAP — ${roadmap.topic_title}
${buildMiniRoadmapContext(roadmap)}

Current subtopic : ${current.title}
Depth level      : ${current.depth}
Page             : ${pageNumber} of ${current.total_pages_planned}
Page focus       : ${pageFocus}
${prev ? `Previously covered: ${prev.title} — established: ${prev.key_concepts_established.join(', ')}` : ''}

Write this page now. Follow the depth rules exactly.
At the end return a JSON block tagged ##concepts## listing 
the key concepts you introduced on this page:
##concepts##
["concept one", "concept two"]`
  }
}
```

---

## Extracting Established Concepts

After each page generates, the AI returns a `##concepts##` block. Parse it and store on the subtopic.

```typescript
// lib/generation/extractConcepts.ts

export function extractConcepts(pageContent: string): {
  cleanContent: string
  concepts: string[]
} {
  const marker = '##concepts##'
  const idx = pageContent.indexOf(marker)
  if (idx === -1) return { cleanContent: pageContent, concepts: [] }

  const cleanContent = pageContent.slice(0, idx).trim()
  try {
    const concepts = JSON.parse(pageContent.slice(idx + marker.length).trim())
    return { cleanContent, concepts }
  } catch {
    return { cleanContent, concepts: [] }
  }
}
```

---

## Page Focus Planning

When a subtopic has multiple pages, each page needs a focus — a specific slice of the subtopic to cover. This is planned at depth classification time, not at generation time.

```typescript
// lib/prompts/planPageFocuses.ts

export function planPageFocusesRequest(
  subtopicTitle: string,
  depth: DepthLevel,
  totalPages: number,
  field: string
) {
  return {
    system: `You are a curriculum designer.
Respond ONLY with valid JSON. No preamble.`,

    user: `Subtopic: ${subtopicTitle}
Depth: ${depth}
Total pages: ${totalPages}
Field: ${field}

Plan what each page should focus on.
Each focus is 1 sentence — specific enough to guide generation,
not so prescriptive it kills the AI's judgment.

Return:
{
  "pages": [
    { "page": 1, "focus": "..." },
    { "page": 2, "focus": "..." }
  ]
}`
  }
}
```

### Example output for Decision Trees — Impurity Measures (critical, 5 pages)

```json
{
  "pages": [
    { "page": 1, "focus": "Introduce the concept of impurity and why pure nodes are the goal" },
    { "page": 2, "focus": "Gini impurity — definition, formula, worked example" },
    { "page": 3, "focus": "Entropy — definition, formula, comparison with Gini" },
    { "page": 4, "focus": "Information gain — how impurity reduction drives split selection" },
    { "page": 5, "focus": "Edge cases — equal splits, multi-class problems, when both measures fail" }
  ]
}
```

---

## Full Setup Sequence

```
user submits topic + goals + level
    ↓
generateRoadmap()
  → returns: full branch tree, all topic titles, prerequisites
    ↓
generateStylePrompt()
  → returns: style anchor string
  → stored on course record
    ↓
for each main topic:
  buildMiniRoadmap()
    → subtopics listed in order
    ↓
  classifyDepth()
    → depth assigned to every subtopic
    ↓
  for each subtopic:
    planPageFocuses()
      → page focuses planned, total_pages_planned set
    ↓
  all subtopics stored to DB with status: pending
    ↓
generatePageBatch(topic[0], subtopic[0], page 1)
  → first pages ready
  → user lands in lesson
```

Everything after the first page batch is lazy — generated on demand by the lookahead trigger. The user never waits.

---

## What Never Changes Per Course

Once generated at setup, these are frozen:

| Field | Frozen at |
|---|---|
| Style prompt | Course creation |
| Depth classification per subtopic | Course creation |
| Page focus plan per subtopic | Course creation |
| Mini roadmap structure | Course creation |
| Subtopic order | Course creation |

What changes constantly:

| Field | Changes when |
|---|---|
| `subtopic.status` | User progresses |
| `subtopic.key_concepts_established` | Each page completes |
| `mini_roadmap.current_index` | Subtopic completes |
| `pages` table | Each batch generates |
| Topic color state | Quiz results |

---

## Rules

- The mini roadmap is always sent with every page generation call. No exceptions.
- The style prompt is always prepended to the system prompt. No exceptions.
- Pages are never regenerated after first generation unless the user explicitly requests a rewrite via inline rewrite.
- The lookahead fires at N-2, not N-1. Give the AI time.
- Key concepts extracted from each page are stored before the next batch fires. The next call must know what was established.
- Page focus is planned at setup time. Generation time is not the place to decide what a page covers.

---

*TruLurn · Page Generation Engine · Part of the technical masterplan*
*Read alongside PLAN.md, NAVIGATION.md, and CLAUDE.md*
