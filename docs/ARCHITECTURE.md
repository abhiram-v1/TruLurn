# TruLurn — Architecture Reference

> How the system is structured and why. Read before making any architectural decision.

---

## System Overview

```
┌─────────────────┬──────────────────────────────┬─────────────────────┐
│   LEFT PANEL    │        MIDDLE PANEL           │    RIGHT PANEL      │
│   Mini Roadmap  │    Structured Lesson          │    Doubt Chat       │
│   190px wide    │    flex: 1                    │    240px wide       │
└─────────────────┴──────────────────────────────┴─────────────────────┘
```

Three panels. Three isolated roles. They do NOT share state or input.

---

## Data Flow

### Course Setup (one-time, async)
```
User: topic + goals
  → POST /api/generate/course
  → Anthropic Batch API (Opus):
      Request 1: roadmap JSON (topics, sections, prerequisites)
      Request 2–N: lesson pages per topic (markdown, stored)
      Request N+1–M: quiz pool per topic (10 questions each)
  → Poll batch status → parse → write to Supabase
  → Redirect to /learn/[courseId]
```
Everything is generated ONCE and stored. The AI does not regenerate on visits.

### Learning Session (read-only, fast)
```
User visits /learn/[courseId]/[topicId]
  → Fetch topic + pages from Supabase (read)
  → Render paginated lesson (middle panel)
  → Render roadmap state (left panel)
  → Mount doubt chat (right panel, lazy)
```

### Doubt Chat (live, per message)
```
User types question
  → Step 1: POST /api/chat/doubt → Haiku relevance check (fast)
      Irrelevant → return redirect message, no Sonnet call
  → Step 2 (if relevant): Sonnet streaming response
      System prompt includes: topic, page number, page content
  → Stream to client, store message in doubt_messages table
```

### Quiz (per session)
```
User opens quiz for topic
  → Fetch 4–5 questions from quiz_questions pool (Supabase)
  → User submits open-ended answers
  → POST /api/quiz/evaluate → Sonnet evaluates each answer
      Returns: { level, passed, feedback, gap, false_confidence }
  → POST /api/roadmap/update → update topic state
  → Roadmap re-renders with new state
```

---

## Database Tables

| Table | Purpose |
|---|---|
| `courses` | One row per course the user creates |
| `topics` | All topics/subtopics in a course, with state + level |
| `pages` | Lesson pages (markdown), one row per page per topic |
| `doubt_messages` | Chat history, per topic (not global) |
| `quiz_questions` | Pre-generated pool of 10 questions per topic |
| `quiz_attempts` | Each quiz session: questions asked, answers, evaluation |

All tables have RLS enabled. Users only see their own data.

---

## Cognitive Model

Every topic has a `state` and an `understanding_level`:

| State | Color | understanding_level |
|---|---|---|
| `locked` | — | null |
| `active` | — | null |
| `partial` | Amber | L2 |
| `functional` | Blue | L3 |
| `mastered` | Green | L4–L5 |
| `unstable` | Red | Any (regressed) |
| `done` | — | Completed, pending re-check |

Levels: L1 Recognition → L2 Mechanical → L3 Conceptual → L4 Transfer → L5 Intuitive

---

## Roadmap State Logic (lib/roadmap.ts)

| Quiz Result | Action |
|---|---|
| L4+ (Transfer/Intuitive), passed | → `mastered`. Unlock adjacent topics if prerequisites met. |
| L2 (Mechanical), passed | → `partial`. Queue conceptual questions for next session. |
| Failed after claiming "I got it" | → `unstable`. Block progression. Surface gap. |
| Failed with prerequisite pattern | → Trace root cause. Mark earlier topic `unstable`. |

**Topics can be downgraded.** Mastered → Unstable is valid if later quiz reveals shallow understanding.

---

## API Routes

| Route | Method | What it does |
|---|---|---|
| `/api/generate/course` | POST | Kicks off Batch API course generation |
| `/api/generate/quiz` | POST | (Called internally during course gen) Quiz pool per topic |
| `/api/chat/doubt` | POST | Relevance check → streaming doubt response |
| `/api/quiz/evaluate` | POST | Evaluates quiz answers, returns EvaluationResult |
| `/api/roadmap/update` | POST | Updates topic state after quiz |

---

## Token Cost Strategy

**Core principle: Generate once, store everything, infer lazily.**

| What | Strategy |
|---|---|
| Lesson pages | Generated once via Batch API. Stored. Served from DB. Never regenerated per visit. |
| Quiz pool | 10 questions per topic, generated once. Serve 4–5 per session from pool. |
| Page rewrites | Send target paragraph ± 2 paragraphs only, not full page. |
| Quiz evaluation | Mastery inference runs on the same call. One call, two jobs. |
| Roadmap updates | Only on explicit triggers (quiz complete, session end). Not per message. |
| Relevance gate | Haiku checks relevance before Sonnet is called for doubt chat. |

---

## What Is NOT In This Architecture (Post-MVP)

- **pgvector / embeddings** — needed for Mode A (source upload). Supabase has it built in. Add when Mode A is built.
- **Knowledge graph edge tracking** — quiz questions that cross two topics should get tagged with both `topic_id`s. Schema can be extended, not present now.
- **Spaced repetition scheduler** — add as a cron job or background worker later.
- **False confidence hook** — can be added as a post-message Haiku inference in doubt chat without changing architecture.
