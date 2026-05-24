# lib/prompts/ — AI Prompt Templates

> Every prompt file exports a function that returns `{ system: string, user: string }`.  
> No raw prompt strings scattered across API routes — all prompts live here.

---

## Files & What They Do

### `generateCourse.ts`
**Function:** `generateCoursePrompt(topic, goals, mode)`  
**Called by:** `POST /api/generate/course`  
**Model:** `claude-opus-4-6` via Batch API  
**Output format:** JSON (validated before writing to DB)  
**Returns:** Roadmap structure — sections, topics, prerequisites, ordering, estimated pages per topic

---

### `generateLesson.ts`
**Function:** `generateLessonPrompt(topicTitle, description, pageNumber, totalPages, prerequisites)`  
**Called by:** `POST /api/generate/course` (batch, one request per topic page)  
**Model:** `claude-opus-4-6` via Batch API  
**Output format:** Markdown string  
**Notes:**
- Each page should be ~400–600 words of focused content
- Structured with a heading, body, and optional example
- Page 1 of any topic must define the concept and why it matters
- Final page should prepare the user for the quiz

---

### `generateQuizPool.ts`
**Function:** `generateQuizPoolPrompt(topicTitle, description, lessonSummary)`  
**Called by:** `POST /api/generate/course` (batch, one request per topic)  
**Model:** `claude-opus-4-6` via Batch API  
**Output format:** JSON array of 10 QuizQuestion objects  
**Notes:**
- Must include all three types: `apply`, `spot_error`, `explain`
- Minimum 3 of each type across the 10 questions
- Each question includes a `rubric` field: what a strong answer looks like (used by evaluator)

---

### `evaluateAnswer.ts`
**Function:** `evaluateAnswerPrompt(question, type, rubric, answer, topic)`  
**Called by:** `POST /api/quiz/evaluate`  
**Model:** `claude-sonnet-4-6`  
**Output format:** JSON — `EvaluationResult`  
**Critical behavior:** Must be strict. Catches:
- Memorized answers with no demonstrated understanding
- Correct procedure, wrong reasoning
- Vague answers that could mean anything
- False confidence (confident tone, wrong content)

---

### `doubtChat.ts`
**Function:** `doubtChatSystem(topic, pageContent, pageNumber)`  
**Called by:** `POST /api/chat/doubt` (Step 2, Sonnet)  
**Model:** `claude-sonnet-4-6` (streaming)  
**Output format:** Streamed text  
**Rules enforced in system prompt:**
1. Only answer questions relevant to current topic + page
2. Do not over-explain
3. If future topic knowledge is needed, say so and stop
4. Never give quiz answers — redirect to thinking
5. Name confusions explicitly — do not paper over them
6. You are not here to be encouraging — you are here to be accurate

---

### `relevanceCheck.ts`
**Function:** `relevanceCheckPrompt(topic, userMessage)`  
**Called by:** `POST /api/chat/doubt` (Step 1, Haiku)  
**Model:** `claude-haiku-4-5-20251001`  
**Output format:** JSON — `{ relevant: boolean, reason: string }`  
**Purpose:** Classify whether the user's doubt is on-topic before calling Sonnet.  
Returns `relevant: false` for: other subjects, future topics, quiz cheating attempts, general chat.

---

### `pageRewrite.ts`
**Function:** `pageRewritePrompt(type, targetParagraph, contextBefore, contextAfter, topicTitle)`  
**Called by:** `POST /api/generate/rewrite` (Day 5)  
**Model:** `claude-sonnet-4-6`  
**Output format:** Markdown string (replacement for target paragraph only)  
**Types:**
- `simplify` — same concept, simpler language, shorter sentences
- `deeper` — more technical depth, mechanisms, edge cases
- `example` — add a concrete worked example at the end of the section

**Token optimization:** Only sends target paragraph ± 2 paragraphs. Not the full page.
