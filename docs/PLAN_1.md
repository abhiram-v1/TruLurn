# TruLurn — Product & Technical Masterplan
> AI-Guided Mastery System · Solo Project · v1.0
> This file is the single source of truth for the product. Read it fully before writing any code.

---

## What TruLurn Is

TruLurn is not an AI tutor. It is not "ChatGPT with folders." It is a **structured learning operating system** that tracks what you actually understand — not just what you clicked or watched.

The core shift:

| What existing tools do | What TruLurn does |
|---|---|
| Track content completion | Infer cognitive state |
| Show quiz scores | Map understanding depth across 5 levels |
| One chat for everything | Isolated spaces: learn, doubt, test |
| Static learning paths | Adaptive roadmap that unlocks and blocks dynamically |
| Soft, encouraging AI | Strict AI that catches false confidence and misconceptions |

The product has **three isolated spaces**:
- **Learn** — structured paginated lessons, AI-authored
- **Ask** — scoped doubt chat, never bleeds into lessons
- **Test** — adversarial quiz, no multiple choice, updates the roadmap

---

## MVP Scope (Build This First)

The MVP is exactly three things done well. Nothing else.

1. **Structured AI lesson** — paginated middle panel, AI writes it once at setup
2. **Scoped doubt chat** — right panel, context-locked to current page
3. **Honest quiz** — 3 question types, generates a pool at setup, updates roadmap state after completion

### What is NOT in the MVP

Do not build these until the core loop above is working and tested:

- Connection graph / knowledge graph view
- Inline text rewrite (select text → mini prompt bar)
- False confidence detection
- Full 5-level cognitive tracking
- Mode A (source upload / PDF parsing)
- Export to PDF / Markdown / Flashcards
- Spaced repetition scheduling
- Bridge lessons for isolated nodes
- Pricing tiers or payments

---

## Entry: Two Modes

### Mode B — AI as Teacher (Build This for MVP)

User describes the topic and their learning goals. No file uploads. AI generates the full curriculum and lesson content from its own knowledge.

- Faster to build (no file processing)
- Trade-off: hallucination risk — surface this clearly in the UI at setup with a visible warning
- This is the MVP entry mode

### Mode A — Source Grounded (Post-MVP, v1.1)

User uploads PDFs, slides, links, or notes. AI builds the plan strictly from the uploaded material, cites sources throughout, stays inside them. More accurate. Requires file parsing infrastructure.

---

## The Three-Panel Interface

After setup, the entire learning experience lives in a single three-panel layout. Each panel has a strict, non-overlapping role.

```
┌─────────────────┬──────────────────────────────┬─────────────────────┐
│   LEFT PANEL    │        MIDDLE PANEL           │    RIGHT PANEL      │
│   Mini Roadmap  │    Structured Lesson          │    Doubt Chat       │
│   190px wide    │    flex: 1                    │    240px wide       │
└─────────────────┴──────────────────────────────┴─────────────────────┘
```

### Left Panel — Mini Roadmap

- Shows the topic tree for the current section (e.g. Supervised Learning → Classification → Linear Regression, SVM, Decision Trees)
- Topics are color-stated: `done` / `active` / `locked` / `unstable`
- Clicking a topic navigates to it if unlocked
- Clicking a locked topic shows a message: "Complete [prerequisite] first"
- No random jumping into locked topics — enforce this
- Small persistent nudge at the bottom: "Weakest connection: [topic]" → opens graph (post-MVP)

### Middle Panel — Structured Lesson (Paginated)

- AI-authored content only
- **No chat input. Ever.** This is not negotiable. The middle panel never has a text input.
- Navigation is prev / next page, like a book. Not scrolling.
- Page-level controls only: `Simplify` / `Go Deeper` / `Add Example` — these trigger a page rewrite, not a chat
- Each page is a stored document, generated once at setup, served from the database
- The AI does not regenerate this on every visit — it is stored and retrieved

### Right Panel — Doubt Chat

- The only place the user types freely
- Context header at the top shows exactly what page they're on: "Context: Linear Regression · Page 2"
- Scoped strictly to the current topic. If user asks about something outside the current topic, AI responds: "That comes when you reach [topic]. Stay focused here for now."
- History is stored per topic, not globally — user can scroll back through this topic's doubts
- Does NOT share history with the main lesson or any other panel

---

## Cognitive Model

### 5 Levels of Understanding

Every topic in TruLurn has a level, not a score.

| Level | Name | Meaning |
|---|---|---|
| L1 | Recognition | Has seen the concept |
| L2 | Mechanical | Can solve standard problems |
| L3 | Conceptual | Understands why it works |
| L4 | Transfer | Can apply it in new contexts |
| L5 | Intuitive | Predicts behavior without solving |

Most students stop at L2 and think they mastered it. TruLurn tracks the difference.

### Topic Color States (Replaces Numerical Scores)

| State | Color | Meaning |
|---|---|---|
| Unstable | Red | Foundation broken or missing |
| Partial | Amber | Mechanical understanding only |
| Functional | Blue | Conceptual grasp |
| Mastered | Green | Intuitive, transferable |

Numerical scores are not shown to the user anywhere. Only color states.

### Cognitive Signals the AI Tracks (Post-MVP, but architect for it)

- Repeated questioning (same concept asked 3 different ways = instability)
- False confidence (user says "I got it" then fails transfer questions)
- Hint dependency (heavy hint use = mechanical, not conceptual)
- Concept switching (rapid topic jumps = avoidance pattern)
- Mistake similarity (same error type recurring = deep misconception)

---

## Quiz System

The quiz is the most important feature. It is the only source of ground truth about what the user actually understands. Everything else is inference. The quiz is measurement. It gets more engineering attention than anything else.

### Three Question Types — No Multiple Choice

**1. Apply**
Give a new scenario, ask the user to apply the concept.
> "Your model has high training accuracy but low test accuracy. What does this tell you about regularization?"

Tests: Transfer (L4)

**2. Spot the Error**
Give flawed reasoning. Ask the user to identify what's wrong and why.
> "A student says: 'I increased my learning rate and the loss went down faster, so higher is always better.' What's wrong with this?"

Tests: Conceptual (L3)

**3. Explain It**
Ask the user to explain the concept to someone who hasn't seen it.
> "Explain gradient descent as if you're talking to someone who only knows basic algebra."

Tests: Intuitive (L5) / Transfer

### Quiz Generation Strategy

- Generate a pool of **10 questions per topic** at course setup time using an async/background AI generation job
- Store all questions in the database — do not regenerate on every quiz attempt
- Serve 4-5 questions per quiz session, sampled from the pool
- Mix all three question types in every session
- AI evaluates answers and returns: `{ level: L1-L5, passed: bool, feedback: string, gap: string | null }`

### How Quiz Results Update the Roadmap

| Result | Roadmap action |
|---|---|
| Pass with transfer (L4+) | Topic → Mastered. Adjacent locked topics unlocked if prerequisites met. |
| Pass mechanical only (L2) | Topic → Partial. Conceptual questions queued for next session. |
| Fail after claiming "I understood" | False confidence flag. Topic → Unstable. AI surfaces the specific gap. Blocks progression. |
| Fail with prerequisite pattern | Root cause traced. Earlier prerequisite topic → Unstable. Revisit scheduled. |

---

## Adaptive Roadmap Logic

The roadmap is not a static checklist. It has active logic.

| Trigger | Action |
|---|---|
| Master vector spaces + transformations | PCA auto-unlocked, linear algebra sections accelerated |
| Struggle with recursion + stack memory | Trees delayed, DP postponed, recursion reinforcement inserted |
| False confidence detected mid-topic | Progression blocked, gap surfaced, re-test required before advancing |
| Isolated node detected (post-MVP) | Bridge lesson generated teaching topic in relation to connected concepts |

Progression is never binary. A topic can be marked `done` and later downgraded to `unstable` if subsequent quiz sessions reveal shallow understanding.

---

## Knowledge Connection Graph (Post-MVP)

This is a separate dedicated view — not embedded in the main three-panel layout. Do not build for MVP.

When built, it has two layers:

**Structural layer (fixed):** Built at course creation. Nodes = topics. Edges = conceptual dependencies. Does not change.

**Mastery layer (live):** Node color = understanding state. Edge thickness = how well the user has connected two topics together. An isolated node (blue) = learned in isolation, never applied in relation to adjacent concepts.

The key insight: a node can be green (mastered) but its edge to another node can be thin. You understood linear regression. You understood gradient descent. But you've never applied one to the other — the edge is weak. This is surface learning made visible.

---

## Technical Direction

### MVP Stack Guidance

The stack is intentionally flexible. Do not treat any framework, hosting provider, database provider, or AI model vendor as part of the product identity.

Use whatever stack best supports the core loop:
- user account or local user identity
- course setup
- stored roadmap topics
- stored lesson pages
- scoped doubt chat
- stored quiz question pool
- quiz evaluation
- roadmap state updates

Good MVP defaults:
- **Frontend:** any productive web framework that can support a dense three-panel learning interface
- **Backend:** simple server routes or a lightweight API layer
- **Database:** relational database preferred, because courses, topics, pages, quiz attempts, and prerequisite relationships are structured data
- **AI provider:** swappable through one internal AI service layer
- **Async jobs:** background generation for course plans, lesson pages, and quiz pools
- **Hosting:** whatever gets the product online with the least operational drag

Rationale:
- The product moat is the learning loop and mastery model, not the vendor stack.
- The AI provider should be replaceable without rewriting product logic.
- Upfront generation should be async/background work so the user sees progress instead of waiting on a live request.
- Keep external services minimal for MVP. Add infrastructure only when the core loop proves it needs it.

---

## File Structure

The previous fixed file tree has been ruled out. Do not follow it as an implementation requirement.

Instead, keep the codebase organized around these product boundaries:
- **Learning surface:** three-panel shell, roadmap, lesson page, page controls, doubt chat
- **Quiz surface:** question rendering, answer capture, evaluation result, roadmap update
- **Setup flow:** topic input, goals, mode selection, generation progress
- **AI service layer:** provider-neutral functions for course generation, doubt chat, quiz pool generation, answer evaluation, relevance checks, and page rewrites
- **Roadmap logic:** unlock/block/update rules separate from UI components
- **Data access:** course, topic, page, doubt message, quiz question, and quiz attempt persistence
- **Shared types/schema:** product-level types should not depend on a specific AI vendor

If a concrete file structure is needed later, derive it from the actual app framework chosen at implementation time.

---

## Database Schema

```sql
-- Users (handled by chosen auth provider)

-- Courses
create table courses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users not null,
  title       text not null,
  topic       text not null,
  goals       text,
  mode        text not null check (mode in ('ai_teacher', 'source_grounded')),
  created_at  timestamptz default now()
);

-- Roadmap topics
create table topics (
  id              uuid primary key default gen_random_uuid(),
  course_id       uuid references courses not null,
  title           text not null,
  parent_id       uuid references topics,        -- for nesting (supervised → classification → linear regression)
  position        int not null,                  -- ordering within parent
  state           text not null default 'locked'
                    check (state in ('locked', 'active', 'done', 'unstable', 'partial', 'functional', 'mastered')),
  understanding_level  int check (understanding_level between 1 and 5),
  prerequisites   uuid[],                        -- topic ids that must be mastered first
  created_at      timestamptz default now()
);

-- Lesson pages
create table pages (
  id          uuid primary key default gen_random_uuid(),
  topic_id    uuid references topics not null,
  page_number int not null,
  content     text not null,                     -- markdown content, AI-generated at setup
  created_at  timestamptz default now(),
  unique(topic_id, page_number)
);

-- Doubt chat messages
create table doubt_messages (
  id          uuid primary key default gen_random_uuid(),
  topic_id    uuid references topics not null,
  page_number int,                               -- which page was active when asked
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  created_at  timestamptz default now()
);

-- Quiz questions pool
create table quiz_questions (
  id           uuid primary key default gen_random_uuid(),
  topic_id     uuid references topics not null,
  type         text not null check (type in ('apply', 'spot_error', 'explain')),
  question     text not null,
  rubric       text,                             -- what a good answer looks like (for AI evaluation)
  created_at   timestamptz default now()
);

-- Quiz attempts
create table quiz_attempts (
  id              uuid primary key default gen_random_uuid(),
  topic_id        uuid references topics not null,
  user_id         uuid references auth.users not null,
  questions_asked uuid[],                        -- question ids served
  answers         jsonb,                         -- { question_id: answer_text }
  evaluation      jsonb,                         -- { question_id: { level, passed, feedback } }
  overall_level   int,
  passed          boolean,
  created_at      timestamptz default now()
);

-- RLS policies (enable row-level security on all tables)
alter table courses         enable row level security;
alter table topics          enable row level security;
alter table pages           enable row level security;
alter table doubt_messages  enable row level security;
alter table quiz_questions  enable row level security;
alter table quiz_attempts   enable row level security;

-- Policy: users can only see their own data
create policy "own data" on courses        for all using (auth.uid() = user_id);
create policy "own data" on topics         for all using (course_id in (select id from courses where user_id = auth.uid()));
create policy "own data" on pages          for all using (topic_id  in (select id from topics where course_id in (select id from courses where user_id = auth.uid())));
create policy "own data" on doubt_messages for all using (topic_id  in (select id from topics where course_id in (select id from courses where user_id = auth.uid())));
create policy "own data" on quiz_questions for all using (topic_id  in (select id from topics where course_id in (select id from courses where user_id = auth.uid())));
create policy "own data" on quiz_attempts  for all using (auth.uid() = user_id);
```

---

## AI Integration

### Model Tier Strategy

Use model tiers by capability, not by vendor name. The implementation should be able to map these tiers to OpenAI-compatible APIs, commercial model providers, local models, or any future provider.

| Task | Model tier | When | Why |
|---|---|---|---|
| Course plan + lesson generation + quiz pool | High-reasoning / high-quality generation model | Once at setup | Quality matters. This is stored and reused. |
| Doubt chat responses | Fast strong conversational model | Per message, streaming if possible | Needs clarity, speed, and cost control. |
| Page rewrites (simplify/deeper/example) | Mid/high-quality rewrite model | On demand | Needs to preserve lesson context and style. |
| Quiz answer evaluation | Strong reasoning/evaluation model | Per quiz submission | Needs nuanced judgment and strict scoring. |
| Relevance checking (is question on-topic?) | Cheap fast classifier model | Before every doubt message | Classification task only. |

### AI Provider Abstraction

Do not scatter provider SDK calls throughout the app. Keep one internal AI service layer with stable product-level functions:

```typescript
type AIService = {
  generateCourse(input: CourseGenerationInput): Promise<CourseGenerationResult>
  generateQuizPool(input: QuizPoolInput): Promise<QuizQuestion[]>
  answerDoubt(input: DoubtChatInput): AsyncIterable<string> | Promise<string>
  evaluateAnswer(input: EvaluationInput): Promise<EvaluationResult>
  checkRelevance(input: RelevanceInput): Promise<RelevanceResult>
  rewriteLessonPage(input: PageRewriteInput): Promise<string>
}
```

The rest of the product should call this interface, not a vendor SDK directly.

### Course Generation Flow

```
User submits topic + goals
  → Server endpoint or action receives setup data
  → Build structured prompts for roadmap, lesson pages, and quiz pool
  → Start async/background generation job:
     - Step 1: Generate roadmap JSON (topics, subtopics, prerequisites, ordering)
     - Step 2-N: Generate lesson pages for each topic
     - Step N+1 to M: Generate quiz pool for each topic (10 questions each)
  → Track job status and progress
  → On completion: parse responses, write to database
  → Redirect user to /learn/[courseId]
```

Course generation is async — show a progress indicator, not a spinner. The user is not blocked live.

### Doubt Chat — Relevance Gating

Every doubt message goes through two steps:

```
1. Relevance check (cheap fast classifier):
   System: "You are a relevance classifier. The user is currently studying [topic]. 
            Respond with JSON: { relevant: boolean, reason: string }"
   
   If relevant: false → do not call the main chat model, return redirect message immediately
   If relevant: true → proceed to step 2

2. Doubt response (fast strong conversational model, streaming if possible):
   System: "You are a strict learning assistant. The user is on page [N] of [topic].
            Current page content: [page_content]
            Answer the doubt clearly and concisely. Do not go beyond this topic.
            If the answer requires knowledge from a future topic, say so and redirect."
```

### Quiz Answer Evaluation

```typescript
// Expected response shape from evaluation prompt
type EvaluationResult = {
  level: 1 | 2 | 3 | 4 | 5           // understanding level demonstrated
  passed: boolean
  feedback: string                     // specific, honest feedback
  gap: string | null                   // what's missing, if anything
  false_confidence: boolean            // did they claim understanding they don't have
}
```

Evaluation prompt must be strict. The AI should catch:
- Memorized answers with no demonstrated understanding
- Correct procedure but wrong reasoning
- Partially correct answers that miss the mechanism
- Vague answers that could mean anything

---

## Token Cost Engineering

### Core Principle
**Generate once. Store everything. Infer lazily.**

Most of what feels like "live AI" does not need to be. Lesson content is static after generation. Roadmap structure is static. Mastery state batches after a session ends.

What actually needs to be live: doubt chat response, page rewrite, quiz evaluation. Everything else is read from the database.

### Specific Optimizations

**Batch generation at setup**
All lesson pages and quiz questions are generated during an async/background setup job. Use batch APIs where available for cost reduction, but do not make the product depend on one provider's batch feature. User sees a progress bar, not a blocked screen.

**Pre-generated quiz pool**
10 questions per topic generated once. Serve from database. Regenerate only if pool is exhausted or mastery state changes significantly (e.g. topic downgraded to unstable).

**Paragraph-level context for rewrites**
For page rewrites (simplify/deeper/example), do not send the full page. Send the target paragraph + 2 paragraphs before + 2 paragraphs after. Enough context. Fraction of the tokens.

**Piggyback inference**
Mastery level inference runs on the same call as quiz evaluation using structured output. One API call, two jobs.

**Trigger-based state updates**
Roadmap state only updates on explicit triggers: quiz completed, topic marked done, session ended. Never on every message.

**Estimated cost per active user hour:**
~30 doubt messages + ~5 page rewrites + 1 quiz session ≈ **$0.05–$0.15 per hour** with tiered model usage.

---

## ⚠️ CRITICAL: Frontend Design Rules

### DO NOT

**Do not build a neon, flashy, gradient-heavy UI. This is non-negotiable.**

Specifically forbidden:
- Purple/violet gradients anywhere. No gradient backgrounds, gradient cards, gradient text, gradient borders. Nothing.
- Neon glows, neon borders, neon shadows
- Animated gradient orbs, mesh backgrounds, aurora effects
- Dark mode with bright neon accent colors on dark backgrounds
- "AI product aesthetic" — that glassy, purple-tinted, over-designed look that every AI startup uses. It looks cheap and dated.
- Heavy drop shadows, glassmorphism, frosted glass effects
- Multiple competing accent colors fighting each other

### The Color Palette Rule

**The founder will provide the color palette. Wait for it. Do not invent one.**

Until the palette is provided, use only:
- White / off-white for backgrounds
- Near-black for text
- One neutral gray for secondary text and borders
- No accent colors at all

When the palette arrives, use it exactly as given. Do not add extra colors. Do not modify the shades. Do not introduce "complementary" colors that weren't in the palette.

### DO

- Flat, clean surfaces. White backgrounds. Generous whitespace.
- Clear typographic hierarchy using weight and size, not color
- Thin, subtle borders (0.5–1px) for separation
- Components that feel like they belong in a serious productivity tool, not a gaming dashboard
- Inspiration direction: Linear, Notion, Raycast — not any AI startup landing page

### Typography

```css
/* Use system font stack for MVP — no custom fonts until palette is confirmed */
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;

/* Scale */
--text-xs:   11px;
--text-sm:   13px;
--text-base: 15px;
--text-lg:   18px;
--text-xl:   22px;
--text-2xl:  28px;

/* Weight: two weights only */
font-weight: 400;  /* body */
font-weight: 500;  /* headings, labels, emphasis */
/* Never use 600, 700, 800 — too heavy for UI text */
```

---

## Prompts Reference

All prompts live in `lib/prompts/`. Every prompt file exports a function that takes parameters and returns `{ system: string, user: string }`.

### `generateCourse.ts`

```typescript
export function generateCoursePrompt(topic: string, goals: string, mode: 'ai_teacher') {
  return {
    system: `You are an expert curriculum designer. You build structured, honest learning plans.
You do not over-promise. You include prerequisites explicitly.
You respond ONLY with valid JSON. No markdown. No explanation outside the JSON.`,
    user: `Design a complete learning curriculum for the following:

Topic: ${topic}
Goals: ${goals}

Return a JSON object with this exact shape:
{
  "title": "course title",
  "sections": [
    {
      "title": "section title",
      "topics": [
        {
          "title": "topic title",
          "description": "1-2 sentence description of what this covers",
          "prerequisites": ["topic title", ...],
          "estimated_pages": 4-8,
          "position": 0
        }
      ]
    }
  ]
}

Rules:
- Maximum 4 sections
- Maximum 6 topics per section
- Order topics so prerequisites always come before dependents
- First topic in the first section must have no prerequisites
- Be accurate. Do not include topics you cannot teach well.`
  }
}
```

### `doubtChat.ts`

```typescript
export function doubtChatSystem(topic: string, pageContent: string, pageNumber: number) {
  return `You are a strict, focused learning assistant for TruLurn.

The student is currently studying: "${topic}" (page ${pageNumber}).

Current page content:
---
${pageContent}
---

Rules you must follow:
1. Only answer questions relevant to this topic and page. If a question is off-topic, respond: "That's covered when you reach [topic]. Stay focused on ${topic} for now."
2. Do not over-explain. Be clear and direct.
3. Do not move ahead. If understanding a question requires future topics, say so and stop.
4. Never give the answer to a quiz question if the student is trying to cheat. Redirect to thinking.
5. If you detect the student is confused about something fundamental, say so explicitly. Do not pretend the confusion does not exist.
6. You are not here to be encouraging. You are here to be accurate.`
}
```

### `evaluateAnswer.ts`

```typescript
export function evaluateAnswerPrompt(question: string, type: string, rubric: string, answer: string, topic: string) {
  return {
    system: `You are a strict evaluator for TruLurn, an AI learning system.
You assess student answers honestly. You do not give credit for vague or memorized responses.
You respond ONLY with valid JSON. No markdown. No preamble.`,
    user: `Topic: ${topic}
Question type: ${type}
Question: ${question}
Rubric (what a strong answer looks like): ${rubric}
Student answer: ${answer}

Evaluate this answer and return:
{
  "level": <1-5>,
  "passed": <boolean>,
  "feedback": "<specific, honest feedback. point out exactly what is missing or wrong>",
  "gap": "<the specific concept or mechanism they don't understand, or null if passed>",
  "false_confidence": <boolean — true if they sound confident but the answer shows they don't understand>
}

Scoring guide:
- L1 (Recognition): They've seen the term but can't use it
- L2 (Mechanical): Correct procedure, no understanding of why
- L3 (Conceptual): Understands why it works, not just how
- L4 (Transfer): Applies correctly to a new context
- L5 (Intuitive): Explains clearly, predicts edge cases, no hesitation

passed = true only at L3 or above for 'explain' and 'apply' type questions.
passed = true only at L3 or above for 'spot_error' type questions.
Be strict. Most students submit L2 answers and expect L4 credit.`
  }
}
```

---

## TypeScript Types

```typescript
// types/index.ts

export type CourseMode = 'ai_teacher' | 'source_grounded'

export type TopicState = 'locked' | 'active' | 'done' | 'unstable' | 'partial' | 'functional' | 'mastered'

export type UnderstandingLevel = 1 | 2 | 3 | 4 | 5

export type QuestionType = 'apply' | 'spot_error' | 'explain'

export interface Course {
  id: string
  user_id: string
  title: string
  topic: string
  goals: string | null
  mode: CourseMode
  created_at: string
}

export interface Topic {
  id: string
  course_id: string
  title: string
  parent_id: string | null
  position: number
  state: TopicState
  understanding_level: UnderstandingLevel | null
  prerequisites: string[]
  created_at: string
  // joined
  pages?: Page[]
  children?: Topic[]
}

export interface Page {
  id: string
  topic_id: string
  page_number: number
  content: string  // markdown
  created_at: string
}

export interface DoubtMessage {
  id: string
  topic_id: string
  page_number: number | null
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export interface QuizQuestion {
  id: string
  topic_id: string
  type: QuestionType
  question: string
  rubric: string | null
  created_at: string
}

export interface QuizAttempt {
  id: string
  topic_id: string
  user_id: string
  questions_asked: string[]
  answers: Record<string, string>
  evaluation: Record<string, EvaluationResult>
  overall_level: UnderstandingLevel | null
  passed: boolean
  created_at: string
}

export interface EvaluationResult {
  level: UnderstandingLevel
  passed: boolean
  feedback: string
  gap: string | null
  false_confidence: boolean
}
```

---

## Environment Variables

```bash
# .env.local

# AI provider
AI_PROVIDER=
AI_API_KEY=
AI_GENERATION_MODEL=
AI_CHAT_MODEL=
AI_EVALUATION_MODEL=
AI_CLASSIFIER_MODEL=

# Database / auth provider
DATABASE_URL=
AUTH_SECRET=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## MVP Build Order

Build in this exact order. Do not skip ahead.

| Day | What to build | Done when |
|---|---|---|
| 1 | Data schema, auth or local user identity, setup page (topic + goals input), async course generation job | User can enter a topic and see "generating..." with real progress |
| 2 | Three-panel layout shell, mini roadmap (left), paginated lesson pages (middle), page navigation | User can read generated lessons page by page |
| 3 | Doubt chat (right panel), context locking, relevance check, streaming responses | User can ask doubts scoped to current page |
| 4 | Quiz page, question serving from pool, text input answers, evaluation API, roadmap state update | User can complete a quiz and see topic state change |
| 5 | Polish: page-level controls (simplify/deeper), locked topic enforcement, error states, loading states | Demo-ready |

---

## What Good Looks Like

When the MVP is working correctly:

1. User signs up, types "Machine Learning" and their goals
2. Sees a progress indicator while course generates in the background
3. Lands on the three-panel view with Supervised Learning → Classification → Linear Regression as the first active topic
4. Reads lesson pages with prev/next navigation
5. Asks a doubt in the right panel — AI answers and refuses to go off-topic
6. Navigates to the quiz for that topic
7. Answers 4-5 questions (apply, spot error, explain)
8. Sees honest feedback and a topic state update
9. If passed, the next topic in the roadmap unlocks
10. If failed, the topic is marked unstable and they're told exactly why

That loop, working cleanly, is the MVP. Every other feature is secondary to this.

---

## Notes for Future Sessions

- The connection graph is the most technically interesting post-MVP feature. Design the database now to support edge strength tracking (quiz questions that cross two topics should be tagged with both topic IDs).
- False confidence detection is a cheap classifier/evaluator task. It can be added as a post-message hook in the doubt chat without changing the architecture.
- Mode A (source upload) requires a document chunking + retrieval pipeline. Use embeddings/vector search when the time comes, but keep the provider swappable. Do not add it to MVP.
- Pricing: standard plan = 1 quiz generation per topic. Higher plans = more flexibility. Keep it affordable for students. Monetize institutions, not individuals.
- The product name is **TruLurn**. Not "Lurnex." Not any other name.

---

*TruLurn Masterplan v1.0 — Generated from planning session. Last updated: 2025.*
*This is a living document. Update it when architectural decisions change.*
