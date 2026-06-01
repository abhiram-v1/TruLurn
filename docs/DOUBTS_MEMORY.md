# TruLurn — Doubt Chat Memory & Decision Architecture

> This document covers exactly how the doubt chat decides what context to send on every message. Read this before touching anything related to the doubt chat pipeline.
> The goal: lean context by default, smart retrieval only when genuinely needed.

---

## The Core Principle

Do not send everything on every call. Decide what the question actually needs, then send exactly that. Nothing more.

Most doubt questions are answerable from the AI's own knowledge or from the current page alone. Vector search and past page retrieval are expensive relative to those cases — they should only fire when the question genuinely requires them.

---

## The Three Question Types

Every doubt message falls into exactly one category. The category determines what gets sent to the answer model.

```
Type 1 — General Knowledge
  Examples:
    "What is entropy?"
    "How does bagging work?"
    "What's the difference between bias and variance?"
    "Why do neural networks need activation functions?"

  What it needs:  AI weights — the model already knows this
  What to send:   Minimal context, just enough to stay on topic
  Retrieval:      None
  Cost:           Cheapest

Type 2 — Current Page
  Examples:
    "Why does this formula use squared error?"
    "Can you give me another example of what's on this page?"
    "What does this term mean in this context?"
    "I don't understand the third paragraph"

  What it needs:  Current page content
  What to send:   Current page + recent history
  Retrieval:      None
  Cost:           Moderate

Type 3 — Course Specific
  Examples:
    "What did we cover about decision trees?"
    "How does this connect to what we learned before?"
    "Isn't random forest just decision trees?"
    "You explained impurity earlier — how does that apply here?"

  What it needs:  Something taught earlier in THIS course
  What to send:   Current page + retrieved past pages
  Retrieval:      Vector search fires
  Cost:           Most expensive, but rarest
```

---

## The Decision System

Two stages. Heuristics first — free and instant. AI classifier only for ambiguous cases.

### Stage 1 — Heuristic Checks (no API call, no cost)

Run these in order. First match wins.

```typescript
// lib/doubts/classifyQuestion.ts

const COURSE_REF_SIGNALS = [
  'we covered', 'you said', 'earlier', 'before',
  'remember when', 'we learned', 'from before',
  'what we did', 'last time', 'previously',
  'you mentioned', 'we talked about', 'we discussed',
  'back when', 'in the beginning', 'at the start'
]

const GENERAL_SIGNALS = [
  'what is', 'what are', 'define', 'explain what',
  'how does', 'why does', 'what is the difference',
  'when should i use', 'what happens when',
  'why is', 'how do you', 'what does it mean when'
]

export function heuristicClassify(
  question:           string,
  currentPageContent: string,
  conceptMap:         string[]   // all concepts established in this course
): QuestionType | 'ambiguous' {

  const q = question.toLowerCase()
  const page = currentPageContent.toLowerCase()

  // Check 1: explicit past reference signals
  // "we covered", "you said earlier", "remember when" etc
  if (COURSE_REF_SIGNALS.some(signal => q.includes(signal))) {
    return 'course_specific'
  }

  // Check 2: concept map mismatch
  // Question mentions a concept that was taught before
  // but is not on the current page
  const mentionsPastConcept = conceptMap.some(concept => {
    const c = concept.toLowerCase()
    return q.includes(c) && !page.includes(c)
  })
  if (mentionsPastConcept) {
    return 'course_specific'
  }

  // Check 3: current page reference
  // Question is clearly about something on this page
  const mentionsPageContent = (
    q.includes('this page') ||
    q.includes('this section') ||
    q.includes('above') ||
    q.includes('here') ||
    q.includes('paragraph') ||
    q.includes('example above') ||
    q.includes('this formula') ||
    q.includes('this equation')
  )
  if (mentionsPageContent) {
    return 'current_page'
  }

  // Check 4: pure general knowledge pattern
  // Starts with general signal AND no concept map mismatch
  const isGeneralPattern = GENERAL_SIGNALS.some(s => q.startsWith(s))
  if (isGeneralPattern && !mentionsPastConcept) {
    return 'general_knowledge'
  }

  // Couldn't decide — escalate to AI classifier
  return 'ambiguous'
}
```

Heuristics resolve roughly 80% of questions without any API call.

---

### Stage 2 — AI Classifier (Haiku, only for ambiguous cases)

Only runs when heuristics return `'ambiguous'`. Uses the cheapest model. Single word response.

```typescript
// lib/doubts/aiClassify.ts

export async function aiClassify(
  question:           string,
  currentPageContent: string
): Promise<QuestionType> {

  // Send only a slice of the page — classifier doesn't need full content
  const pageSlice = currentPageContent.slice(0, 600)

  const response = await complete(
    'relevance_check',   // routes to Haiku
    `You are a question classifier for an educational platform.
Classify the student question into exactly one category.
Respond with ONLY the category name. No explanation. No punctuation.

GENERAL  — answerable from general AI knowledge, no course context needed
PAGE     — answerable from the current page content alone
COURSE   — references something taught earlier in this specific course`,

    `Current page (excerpt):
${pageSlice}

Student question:
${question}

Category:`
  )

  const map: Record<string, QuestionType> = {
    'GENERAL': 'general_knowledge',
    'PAGE':    'current_page',
    'COURSE':  'course_specific',
  }

  return map[response.trim().toUpperCase()] ?? 'current_page'
}
```

Cost of this call: ~500 tokens on Haiku ≈ $0.0005. Half a tenth of a cent.

---

### Full Classification Function

```typescript
// lib/doubts/classifyQuestion.ts

export async function classifyQuestion(
  question:           string,
  currentPageContent: string,
  conceptMap:         string[]
): Promise<QuestionType> {

  // Stage 1 — heuristics, free
  const heuristicResult = heuristicClassify(
    question,
    currentPageContent,
    conceptMap
  )

  if (heuristicResult !== 'ambiguous') {
    return heuristicResult   // resolved without any API call
  }

  // Stage 2 — AI classifier, only for ambiguous cases
  return await aiClassify(question, currentPageContent)
}
```

---

## Context Built Per Type

What gets sent to the answer model depends entirely on the classification result.

### Type 1 — General Knowledge

```typescript
// Minimal context
// AI answers from weights
// Just enough to keep the answer relevant to the course

{
  system: `
    ${DOUBT_SYSTEM_PROMPT}

    The student is currently studying:
    Topic: ${currentPage.topicTitle}
    Subtopic: ${currentPage.subtopicTitle}

    Answer from your knowledge.
    Keep the answer relevant to this topic.
    Be direct and accurate.
    Do not invent course-specific content you were not given.
  `,
  messages: [
    ...recentHistory.slice(-4),   // last 4 messages for conversational flow
    { role: 'user', content: question }
  ]
}

// Token estimate:
// System prompt base:      400t
// Topic context:            50t
// Recent history (4 msgs): 280t
// Question:                 30t
// ─────────────────────────────
// Total:                   760t
// Cost (GPT-5.4 mini):  ~$0.001
```

---

### Type 2 — Current Page

```typescript
// Current page + recent history
// No retrieval

{
  system: `
    ${DOUBT_SYSTEM_PROMPT}

    ${YOU_ARE_HERE_POINTER(currentPage)}

    CURRENT PAGE CONTENT:
    ${currentPage.content}
  `,
  messages: [
    ...recentHistory.slice(-6),   // last 6 messages
    { role: 'user', content: question }
  ]
}

// Token estimate:
// System prompt base:      400t
// You are here pointer:    150t
// Current page:            700t
// Recent history (6 msgs): 400t
// Question:                 30t
// ─────────────────────────────
// Total:                  1680t
// Cost (GPT-5.4 mini):  ~$0.002
```

---

### Type 3 — Course Specific

```typescript
// Vector search fires
// Retrieved pages injected alongside current page

const pastPages = await findRelevantPages(
  question,
  courseId,
  currentPage.topicId,   // exclude current topic from search
  limit: 2
)

{
  system: `
    ${DOUBT_SYSTEM_PROMPT}

    ${YOU_ARE_HERE_POINTER(currentPage)}

    CURRENT PAGE CONTENT:
    ${currentPage.content}

    RELEVANT CONTENT FROM EARLIER IN THIS COURSE:
    ${pastPages.map(p => `
      [${p.subtopicTitle} — page ${p.pageNumber}]
      ${p.content}
    `).join('\n---\n')}

    The student is asking about something covered in a past page.
    Use the retrieved content above to answer accurately.
    Reference what was actually taught, not general knowledge.
  `,
  messages: [
    ...recentHistory.slice(-6),
    { role: 'user', content: question }
  ]
}

// Token estimate:
// System prompt base:        400t
// You are here pointer:      150t
// Current page:              700t
// Retrieved pages (x2):     1200t
// Recent history (6 msgs):   400t
// Question:                   30t
// ──────────────────────────────
// Total:                    2880t
// Cost (GPT-5.4 mini):   ~$0.004
```

---

## The You Are Here Pointer

Always included for Type 2 and Type 3. Tells the AI exactly where the student is without ambiguity.

```typescript
// lib/doubts/buildPointer.ts

export function YOU_ARE_HERE_POINTER(page: Page): string {
  return `
=== CURRENT POSITION ===
Primary topic:    ${page.branchTitle} (${page.branchPosition} of ${page.branchTotal})
Subtopic:         ${page.subtopicTitle} (${page.subtopicPosition} of ${page.subtopicTotal})
Current page:     Page ${page.pageNumber} of ${page.totalPages} — "${page.pageFocus}"
========================

Pages covered in this subtopic so far:
${page.previousPageFocuses.map((focus, i) =>
  `  Page ${i + 1}: ${focus}${i + 1 === page.pageNumber ? ' ← STUDENT IS HERE' : ''}`
).join('\n')}

What comes next:
${page.upcomingPageFocuses.map((focus, i) =>
  `  Page ${page.pageNumber + i + 1}: ${focus}`
).join('\n')}
`.trim()
}
```

Example output:

```
=== CURRENT POSITION ===
Primary topic:    Supervised Learning (2 of 6 topics)
Subtopic:         Decision Trees (3 of 5 subtopics)
Current page:     Page 3 of 5 — "How splits are chosen"
========================

Pages covered in this subtopic so far:
  Page 1: What is a decision tree and when to use it
  Page 2: The concept of impurity and why pure nodes matter
  Page 3: Gini impurity, entropy, comparison ← STUDENT IS HERE

What comes next:
  Page 4: Information gain, how splits are selected
  Page 5: Overfitting, pruning, hyperparameters
```

~150 tokens. The AI knows exactly where it is, what's been covered, what's coming.

---

## The Concept Map

Lightweight long-term memory. Sent with Type 2 and Type 3 calls. Used by heuristic classifier to detect concept map mismatches.

```typescript
// lib/doubts/buildConceptMap.ts

export async function getConceptMap(
  courseId: string
): Promise<string[]> {
  const topics = await db.collection('topics')
    .find({ courseId })
    .project({ keyConcepts: 1 })
    .toArray()

  return topics.flatMap((t: any) => t.keyConcepts ?? [])
}

// Returns something like:
// ["decision tree", "impurity", "Gini", "entropy",
//  "information gain", "overfitting", "pruning",
//  "linear regression", "OLS", "gradient descent"]

// Used in two ways:
// 1. Heuristic classifier: detect when question mentions past concept
// 2. Answer model context: tells AI what vocabulary exists in this course
```

Sent as a comma-separated list in the system prompt — roughly 200 tokens for a full course.

---

## Graceful Failure Mode

What if the classifier gets it wrong — says Type 1 or Type 2 when the question actually needs past content?

The answer model handles it:

```typescript
// Add to DOUBT_SYSTEM_PROMPT:

`If you are asked about a concept that is not in your provided context
and you are not confident answering from general knowledge alone,
respond with exactly this phrase and nothing else:

"NEEDS_RETRIEVAL: [brief description of what concept is needed]"

Do not attempt to answer. Do not explain. Just return that phrase.`
```

The frontend detects `NEEDS_RETRIEVAL:` in the response, extracts the concept description, fires vector search with it, and retries with retrieved content. Silent to the user — they see a brief pause then the correct answer.

```typescript
// lib/doubts/handleResponse.ts

export async function processResponse(
  response: string,
  question: string,
  courseId: string,
  topicId: string,
  currentPage: Page,
  recentHistory: Message[]
): Promise<string> {

  if (response.startsWith('NEEDS_RETRIEVAL:')) {
    // Classifier was wrong — fire retrieval and retry
    const concept = response.replace('NEEDS_RETRIEVAL:', '').trim()

    const pastPages = await findRelevantPages(
      concept,    // use extracted concept, not full question
      courseId,
      topicId,
      limit: 2
    )

    // Rebuild context as Type 3 and retry
    const context = buildCourseSpecificContext(
      question, currentPage, pastPages, recentHistory
    )

    return await complete('doubt_chat', context.system, context.messages)
  }

  return response
}
```

This means even if classification fails, the user still gets a correct answer. The system recovers gracefully.

---

## Full Doubt Chat Handler

```typescript
// lib/doubts/handleDoubt.ts

export async function handleDoubt(
  userId:      string,
  courseId:    string,
  topicId:     string,
  pageId:      string,
  question:    string
): Promise<ReadableStream> {

  // 1. Fetch what we need from DB (parallel)
  const [currentPage, recentHistory, conceptMap] = await Promise.all([
    db.collection('pages').findOne({ _id: pageId }),
    db.collection('doubt_messages')
      .find({ topicId, userId })
      .sort({ createdAt: -1 })
      .limit(6)
      .toArray()
      .then(msgs => msgs.reverse()),
    getConceptMap(courseId)
  ])

  // 2. Classify the question
  const type = await classifyQuestion(
    question,
    currentPage.content,
    conceptMap
  )

  // 3. Build context based on type
  let context: { system: string; messages: Message[] }

  switch (type) {
    case 'general_knowledge':
      context = buildGeneralContext(
        question, currentPage, recentHistory
      )
      break

    case 'current_page':
      context = buildCurrentPageContext(
        question, currentPage, recentHistory, conceptMap
      )
      break

    case 'course_specific':
      const pastPages = await findRelevantPages(
        question, courseId, topicId, 2
      )
      context = buildCourseSpecificContext(
        question, currentPage, pastPages, recentHistory
      )
      break
  }

  // 4. Stream response from answer model
  const stream = await streamComplete('doubt_chat', context)

  // 5. Store message + embed async (don't await — user doesn't wait)
  storeAndEmbed(userId, courseId, topicId, currentPage.pageNumber, question, 'user')

  // 6. Collect full response for storage (happens in background)
  collectAndStore(stream, userId, courseId, topicId, currentPage.pageNumber)

  return stream
}
```

---

## Cost Summary Per Message

```
Type 1 — General knowledge
  Stage 1 heuristic:          free
  Stage 2 AI classify:        $0.0005  (only if ambiguous)
  Answer model:               ~$0.001
  ─────────────────────────────────────
  Total:                      ~$0.001

Type 2 — Current page
  Stage 1 heuristic:          free
  Stage 2 AI classify:        $0.0005  (only if ambiguous)
  Answer model:               ~$0.002
  ─────────────────────────────────────
  Total:                      ~$0.002

Type 3 — Course specific
  Stage 1 heuristic:          free
  Stage 2 AI classify:        $0.0005  (only if ambiguous)
  Vector search embedding:    ~$0.0001
  Answer model:               ~$0.004
  ─────────────────────────────────────
  Total:                      ~$0.005

Graceful failure retry:
  + vector search:            ~$0.0001
  + answer retry:             ~$0.003
  ─────────────────────────────────────
  Retry total:                ~$0.003 extra (rare)
```

Assuming a typical session: 60% Type 1/2, 40% Type 3, ~2% retry rate.
Average cost per doubt message: **~$0.002–0.003**
50 messages in a session: **~$0.10–0.15**

---

## The Random Forest Example — Traced Through

```
Student is on: Supervised Learning → Ensemble Methods → Random Forests, page 2
Student asks:  "Isn't random forest just decision trees inside?"

Stage 1 heuristic:
  COURSE_REF_SIGNALS check:    no signals found
  Concept map mismatch check:  "decision trees" in concept map? YES
                               "decision trees" on current page? NO
  → Mismatch detected
  → classified as 'course_specific' instantly
  → no API call needed

Vector search fires:
  embed "isn't random forest just decision trees inside"
  search pages collection
  filter: courseId = this course, topicId ≠ current topic
  returns:
    Decision Trees — page 1 (what is a decision tree)  score: 0.91
    Decision Trees — page 2 (how splits work)           score: 0.87

Context built (Type 3):
  current page (Random Forests)          700t
  you are here pointer                   150t
  decision trees page 1                  650t
  decision trees page 2                  650t
  recent history (6 messages)            400t
  ────────────────────────────────────────────
  Total                                 2550t

Answer model receives full context and responds:
  "Random forests are built from many decision trees working together.
   As we covered in the decision trees section — each tree splits data
   using impurity measures like Gini impurity and entropy to find the
   best threshold at each node. A random forest trains hundreds of
   these trees, each on a random subset of your training data and a
   random subset of features. When predicting, every tree votes and
   the majority wins. The randomness prevents any single tree from
   overfitting — the ensemble is more robust than any individual tree."

Answer is:
  ✓ Accurate
  ✓ Connected to what was specifically taught
  ✓ References actual course content (Gini, entropy)
  ✓ Explains the relationship clearly
```

---

## Build Order

### MVP
```
✓ classifyQuestion() with heuristics only (no AI classifier yet)
✓ Three context builders (general, page, course_specific)
✓ YOU_ARE_HERE_POINTER
✓ Concept map from keyConcepts fields
✓ Recent history sliding window (last 6)
✓ Store messages to DB
✗ No vector search yet — course_specific falls back to current page
✗ No AI classifier yet — ambiguous → default to current_page
✗ No graceful failure retry yet

Good enough for MVP. Most questions handled correctly by heuristics.
```

### Post-MVP v1.1
```
✓ Add embedding to pages collection
✓ findRelevantPages() vector search
✓ course_specific type fully resolved with retrieval
✓ AI classifier (Haiku) for ambiguous cases
✓ NEEDS_RETRIEVAL graceful failure handling
✓ Store + embed doubt_messages async
```

### Post-MVP v1.2
```
✓ Semantic search over doubt_messages history
✓ Doubt session summarisation (>20 messages)
✓ Fine-tune classification thresholds from real usage data
```

---

## Rules

- Never send more context than the question type requires
- Heuristics run first on every message — no exceptions
- AI classifier only runs when heuristics return ambiguous
- Vector search only fires for course_specific type
- General knowledge questions never get past page content injected
- The YOU ARE HERE pointer is always included for Type 2 and Type 3
- Messages are stored async — user never waits for storage to complete
- Embeddings are generated async — exclude null embeddings from vector search

---

*TruLurn · DOUBTS_MEMORY.md · Part of the technical masterplan*
*Read alongside PLAN.md, MEMORY.md, GENERATION.md, and CLAUDE.md*
