# app/api/ — API Routes

> All server-side logic lives here. These are Next.js Route Handlers (not pages).  
> All routes use `export async function POST(req: Request)` pattern.

---

## Routes

### `/api/generate/course` — POST
**File:** `generate/course/route.ts`  
**Called by:** `setup/page.tsx` when user submits topic + goals  
**What it does:**
1. Validates input (topic, goals, userId)
2. Builds batch requests for Anthropic Batch API (Opus):
   - Request 1: full roadmap JSON (topics, sections, prerequisites, ordering)
   - Requests 2–N: lesson pages for each topic (markdown content, multiple pages per topic)
   - Requests N+1–M: quiz pool for each topic (10 questions each)
3. Submits batch → returns `{ batchId, courseId }` immediately (non-blocking)
4. Client polls for completion or uses polling endpoint

**Returns:** `{ batchId: string, courseId: string }`

---

### `/api/generate/quiz` — POST
**File:** `generate/quiz/route.ts`  
**Called by:** Internally during course generation (not called by client directly)  
**What it does:** Generates a quiz pool (10 questions) for a specific topic using Batch API.  
**Returns:** Array of `QuizQuestion` objects

---

### `/api/chat/doubt` — POST
**File:** `chat/doubt/route.ts`  
**Called by:** `DoubtChat.tsx` (right panel) on every user message  
**What it does:**
1. Step 1 — Haiku relevance check:
   - Input: `{ topic, pageContent, userMessage }`
   - Output: `{ relevant: boolean, reason: string }`
   - If `relevant: false` → return redirect message, skip Step 2
2. Step 2 — Sonnet streaming response:
   - System prompt includes: topic, page number, page content
   - Streams response back to client via ReadableStream
3. Saves both user message and assistant response to `doubt_messages` table

**Returns:** Streaming text response (SSE / ReadableStream)

---

### `/api/quiz/evaluate` — POST
**File:** `quiz/evaluate/route.ts`  
**Called by:** `QuizSession.tsx` on quiz submission  
**What it does:**
1. Receives: `{ topicId, questions: [{id, question, type, rubric, answer}] }`
2. Evaluates each answer using Sonnet (structured output)
3. Returns evaluation for each question
4. Also determines overall level for the session

**Returns:**
```typescript
{
  evaluations: Record<string, EvaluationResult>,
  overallLevel: 1 | 2 | 3 | 4 | 5,
  passed: boolean
}
```

---

### `/api/roadmap/update` — POST
**File:** `roadmap/update/route.ts`  
**Called by:** `QuizResult.tsx` after evaluation is returned  
**What it does:**
1. Receives: `{ topicId, overallLevel, passed, falseConfidence }`
2. Runs roadmap state logic (`lib/roadmap.ts`):
   - Updates current topic state
   - Unlocks adjacent topics if prerequisites met
   - Marks prerequisite topics as unstable if pattern detected
3. Writes updated states to `topics` table

**Returns:** `{ updatedTopics: Topic[] }` — the topics whose state changed

---

## Shared Patterns

```typescript
// Error handling pattern for all routes
try {
  // ... logic
  return Response.json({ data }, { status: 200 })
} catch (error) {
  console.error('[route-name]', error)
  return Response.json({ error: 'Internal server error' }, { status: 500 })
}

// Auth check pattern (use in all routes)
const supabase = createClient()
const { data: { user } } = await supabase.auth.getUser()
if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
```
