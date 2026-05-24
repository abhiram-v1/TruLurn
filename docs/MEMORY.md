# TruLurn — Memory & Retrieval Architecture

> This document covers how TruLurn simulates persistent memory across sessions, topics, and courses using a two-layer retrieval system. Read this before touching anything related to context, embeddings, or the doubt chat pipeline.
> **Database: MongoDB Atlas** — vector search via Atlas Vector Search, no pgvector, no RLS.

---

## The Core Insight

The API has no memory. Every inference call starts from zero. What feels like memory in TruLurn is entirely engineered — structured data stored in MongoDB, retrieved selectively, and injected into each API call as context.

This works the same way claude.ai works. Anthropic stores every message in a conversation and injects the relevant history into each call. TruLurn does the same thing, but with two retrieval layers instead of one sequential window.

**Most RAG applications:**
```
Raw source chunks → vector search → AI answer
```

**TruLurn:**
```
Raw source chunks → vector search → AI generates lesson pages
                                              ↓
                              Lesson pages → vector search → AI answers doubts
```

The intermediate layer of lesson pages is what separates TruLurn from a standard RAG app. By the time content reaches the doubt chat retrieval layer, it has already been processed, calibrated to the student's level, written in the course's voice, and structured at the right depth. The AI isn't retrieving dense academic text and interpreting it on the fly. It's retrieving content that was already explained correctly for this specific student.

---

## The Two Layers

### Layer 1 — Source → Lesson Pages

**Purpose:** Generate accurate, source-grounded lesson content.

**Input:** Raw uploaded source material (PDFs, slides, links) or AI knowledge (Mode B).

**Process:**
1. Source parsed and split into chunks (~400 tokens each, 50 token overlap)
2. Each chunk embedded and stored with a topic tag
3. At page generation time: vector search finds the most relevant chunks for the current subtopic
4. Top 3-4 chunks sent to AI alongside mini roadmap, style prompt, and page focus
5. AI generates the lesson page from retrieved chunks
6. Page stored in DB with its own embedding

**Output:** Structured lesson pages, already processed and calibrated.

**Mode B note:** No source chunks exist. Layer 1 uses AI knowledge directly. The retrieval step is skipped — only the mini roadmap and style prompt are sent. Layer 2 still works identically because lesson pages are stored regardless of how they were generated.

---

### Layer 2 — Lesson Pages → Doubt Chat

**Purpose:** Answer student questions with context of what was actually taught.

**Input:** Student question in the doubt chat.

**Process:**
1. Question embedded
2. Vector search over stored lesson pages (all past topics in this course)
3. Sliding window of last 6 doubt messages retrieved from DB
4. Backward reference detected? Inject relevant past lesson pages.
5. All context assembled and sent to AI
6. AI answers in context of what the student already learned
7. Message stored for future sliding window

**Output:** Contextually accurate doubt response grounded in the student's own lesson history.

**Why lesson pages and not source chunks:**
Source chunks are dense, academic, and unprocessed. The lesson pages are already at the right depth, in the right voice, with the right examples. Retrieving them for doubt chat means the AI is working with material the student has already encountered — it can say "as we covered in the decision trees section" and be accurate.

---

## MongoDB Collections

Three collections. Two embedding fields. That is the entire memory system.

Data isolation is enforced at the **application layer** — every query includes `userId` or `courseId` as a filter. MongoDB has no RLS. Never query without a user or course scope.

```typescript
// source_chunks — Layer 1: Raw source material (Mode A only)
{
  _id:         ObjectId,
  courseId:    ObjectId,    // always filter by this
  sourceId:    ObjectId,
  topicId:     ObjectId,   // which topic this chunk covers
  chunkIndex:  Number,     // position in original source
  content:     String,     // ~400 tokens of raw source text
  summary:     String,     // one sentence summary
  embedding:   [Number],   // 1536-dim vector for Atlas Vector Search
  createdAt:   Date
}

// pages — Layer 1 + 2: Generated lesson content
{
  _id:          ObjectId,
  courseId:     ObjectId,   // always filter by this
  topicId:      ObjectId,
  pageNumber:   Number,
  content:      String,     // full markdown + diagram specs
  embedding:    [Number],   // 1536-dim vector for Atlas Vector Search
  keyConcepts:  [String],   // concepts established on this page
  createdAt:    Date
}

// doubt_messages — Layer 2: Doubt chat history
{
  _id:         ObjectId,
  courseId:    ObjectId,   // always filter by this
  userId:      ObjectId,   // always filter by this
  topicId:     ObjectId,
  pageNumber:  Number,     // page active when question was asked
  role:        String,     // 'user' | 'assistant'
  content:     String,
  embedding:   [Number],   // 1536-dim vector for semantic history search
  createdAt:   Date
}
```

---

## Atlas Vector Search Index Setup

MongoDB Atlas has native vector search — no external vector DB needed. Define search indexes on each collection in the Atlas UI or via CLI.

```json
// Index on pages collection
{
  "mappings": {
    "dynamic": false,
    "fields": {
      "embedding": {
        "dimensions": 1536,
        "similarity": "cosine",
        "type": "knnVector"
      },
      "courseId": { "type": "token" },
      "topicId":  { "type": "token" }
    }
  }
}

// Index on source_chunks collection
{
  "mappings": {
    "dynamic": false,
    "fields": {
      "embedding": {
        "dimensions": 1536,
        "similarity": "cosine",
        "type": "knnVector"
      },
      "courseId": { "type": "token" },
      "topicId":  { "type": "token" }
    }
  }
}

// Index on doubt_messages collection
{
  "mappings": {
    "dynamic": false,
    "fields": {
      "embedding": {
        "dimensions": 1536,
        "similarity": "cosine",
        "type": "knnVector"
      },
      "courseId": { "type": "token" },
      "userId":   { "type": "token" }
    }
  }
}
```

---

## The Full Pipeline — End to End

### Setup

```
User uploads source (Mode A) or describes topic (Mode B)
        ↓
Mode A: source text extracted
  PDF    → pdf-parse
  Links  → cheerio scraper
  DOCX   → mammoth
        ↓
Mode A: text split into chunks (~400 tokens, 50 token overlap)
  Why overlap: concepts don't end cleanly at chunk boundaries
  Without overlap: concepts spanning two chunks get missed
        ↓
Mode A: each chunk embedded + inserted into source_chunks collection
        ↓
Both modes: AI generates roadmap + style prompt + depth classification
        ↓
Both modes: mini roadmaps built, page focuses planned, all stored
```

---

### Learning — Page Generation Cycle

```
User enters a topic branch
        ↓
First subtopic auto-fires generation

  Mode A:
    embed current subtopic focus
    $vectorSearch over source_chunks for top 3-4 relevant chunks
    retrieved chunks sent as SOURCE MATERIAL in prompt

  Mode B:
    no source chunks
    AI generates from knowledge using mini roadmap only
        ↓
  AI generates page using:
    system prompt + style prompt    (cached)
    mini roadmap with state         (from DB)
    key concepts established        (from DB)
    page focus                      (planned at setup)
    source chunks (Mode A only)     (fresh, from vector search)
        ↓
  Page inserted into pages collection
  Embedding generated async and updated on the document
  Key concepts extracted and stored on topic document
        ↓
Lookahead fires at page N-2
  Next batch generates while user reads current page
  User never waits
        ↓
Cycle repeats across all subtopics and topics
```

---

### Doubt Chat — Retrieval Cycle

```
User types a question
        ↓
Question embedded
        ↓
Two parallel operations fire simultaneously:

  Operation A — sliding window (always):
    db.doubt_messages.find({ topicId, userId })
      .sort({ createdAt: -1 }).limit(6)
    ~400 tokens, gives conversational continuity

  Operation B — vector search (conditional):
    is this a backward reference?
    detect keywords: "earlier", "before", "remember",
                     "we said", "from before", "back when",
                     "what was that thing about"
    if yes:
      $vectorSearch over pages collection (courseId filter, exclude current topicId)
      find top 2 most semantically similar lesson pages
      ~800 tokens of already-calibrated lesson content
    if no:
      skip — current page content is sufficient
        ↓
Context assembled:

  Always included:
    system prompt + style prompt      ~500 tokens  (cached)
    current page content              ~600 tokens
    sliding window (last 6 messages)  ~400 tokens
    concept map (all established)     ~200 tokens

  Conditionally included:
    retrieved past lesson pages       +800 tokens  (backward ref only)
    source chunk (if page insufficient) +400 tokens (rare)
  ──────────────────────────────────────────────────
  Max total per call                  2500 tokens
        ↓
AI answers with full context of what was actually taught
        ↓
Both user message and AI response inserted into doubt_messages
Both embedded async for future semantic search
        ↓
Cycle repeats — sliding window now includes this exchange
```

---

## Retrieval Functions

```typescript
// lib/retrieval.ts
import { OpenAI } from 'openai'
import { connectDB } from './mongodb'

const openai = new OpenAI()

// Generate embedding for any text
export async function embed(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  })
  return res.data[0].embedding
}

// Layer 2: find relevant past lesson pages
export async function findRelevantPages(
  question:        string,
  courseId:        string,
  excludeTopicId:  string,
  limit =          2
) {
  const db = await connectDB()
  const embedding = await embed(question)

  return db.collection('pages').aggregate([
    {
      $vectorSearch: {
        index:          'pages_vector_index',
        path:           'embedding',
        queryVector:    embedding,
        numCandidates:  50,
        limit,
        filter: {
          courseId: { $eq: courseId },
          topicId:  { $ne: excludeTopicId }
        }
      }
    },
    {
      $match: {
        score: { $gte: 0.75 }   // minimum similarity threshold
      }
    },
    {
      $project: {
        content:    1,
        topicId:    1,
        pageNumber: 1,
        score:      { $meta: 'vectorSearchScore' }
      }
    }
  ]).toArray()
}

// Layer 1: find relevant source chunks for page generation
export async function findRelevantChunks(
  subtopicFocus: string,
  topicId:       string,
  courseId:      string,
  limit =        4
) {
  const db = await connectDB()
  const embedding = await embed(subtopicFocus)

  return db.collection('source_chunks').aggregate([
    {
      $vectorSearch: {
        index:          'chunks_vector_index',
        path:           'embedding',
        queryVector:    embedding,
        numCandidates:  50,
        limit,
        filter: {
          courseId: { $eq: courseId },
          topicId:  { $eq: topicId }
        }
      }
    },
    {
      $match: {
        score: { $gte: 0.70 }
      }
    },
    {
      $project: {
        content: 1,
        summary: 1,
        score:   { $meta: 'vectorSearchScore' }
      }
    }
  ]).toArray()
}
```

---

## Backward Reference Detection

```typescript
// lib/retrieval/detectBackwardRef.ts

const BACKWARD_REF_SIGNALS = [
  'earlier', 'before', 'remember when', 'we said',
  'from before', 'back when', 'previously', 'last time',
  'what was that', 'you mentioned', 'we covered',
  'in the beginning', 'at the start', 'from the other'
]

export function isBackwardReference(question: string): boolean {
  const lower = question.toLowerCase()
  return BACKWARD_REF_SIGNALS.some(signal => lower.includes(signal))
}
```

Simple string matching for MVP. Upgrade to a Haiku classification call later if false positives become a problem.

---

## Context Assembly — Full Function

```typescript
// lib/context/buildDoubtContext.ts

export async function buildDoubtContext(
  userId:       string,
  courseId:     string,
  topicId:      string,
  currentPage:  Page,
  userQuestion: string
) {
  const db = await connectDB()

  // 1. Sliding window — last 6 doubt messages
  const recentHistory = await db.collection('doubt_messages')
    .find({ topicId, userId })
    .sort({ createdAt: -1 })
    .limit(6)
    .toArray()
    .then(msgs => msgs.reverse())   // back to chronological

  // 2. Concept map — lightweight long-term memory
  const topics = await db.collection('topics')
    .find({ courseId })
    .project({ keyConcepts: 1 })
    .toArray()

  const conceptMap = topics
    .flatMap((t: any) => t.keyConcepts ?? [])
    .filter(Boolean)
    .join(', ')

  // 3. Conditional — past lesson pages for backward references
  const pastPages = isBackwardReference(userQuestion)
    ? await findRelevantPages(userQuestion, courseId, topicId)
    : []

  const pastPagesContext = pastPages.length > 0
    ? pastPages.map((p: any) => `
        [From: page ${p.pageNumber} of topic ${p.topicId}]
        ${p.content}
      `).join('\n---\n')
    : ''

  // 4. Assemble messages array
  const messages = [
    ...recentHistory.map((m: any) => ({
      role:    m.role,
      content: m.content
    })),
    { role: 'user', content: userQuestion }
  ]

  // 5. System prompt with all context
  const system = `
    ${doubtChatBasePrompt}

    CURRENT PAGE:
    Topic: ${currentPage.topicTitle}
    Subtopic: ${currentPage.subtopicTitle}
    Page ${currentPage.pageNumber}:
    ${currentPage.content}

    CONCEPTS ESTABLISHED IN THIS COURSE:
    ${conceptMap}

    ${pastPagesContext ? `RELEVANT PAST CONTENT:\n${pastPagesContext}` : ''}
  `.trim()

  return { system, messages }
}
```

---

## Embedding Strategy

```
Model:       text-embedding-3-small (OpenAI)
Dimensions:  1536
Cost:        $0.02 per million tokens
When:        MVP default

Upgrade to:  text-embedding-3-large (3072 dims, $0.13/M)
When:        retrieval quality becomes a measurable issue at scale
```

### When embeddings are generated

```
source_chunks:    synchronously at upload, before course setup completes
pages:            async immediately after page is stored — user doesn't wait
doubt_messages:   async immediately after message is stored
```

Async embedding means the user never waits for the embedding write. The embedding is only needed on future calls for vector search, not for the current response.

---

## Context Budget Per Call

### Page Generation (Mode B)
```
Component                     Tokens    Cached?
─────────────────────────────────────────────────
System + style prompt          800      yes — nearly free
Mini roadmap                   400      yes after first call
Key concepts established        100      yes
Page focus                      50      yes
─────────────────────────────────────────────────
Total                         1350      mostly cached
Cost                        ~$0.004 per page (GPT-5.4 mini)
```

### Page Generation (Mode A)
```
Component                     Tokens    Cached?
─────────────────────────────────────────────────
System + style prompt          800      yes
Mini roadmap                   400      yes
Key concepts established        100      yes
Page focus                      50      yes
Source chunks (3-4)           1600      no — fresh each call
─────────────────────────────────────────────────
Total                         2950      partially cached
Cost                        ~$0.010 per page (GPT-5.4 mini)
```

### Doubt Chat (base)
```
Component                     Tokens    Cached?
─────────────────────────────────────────────────
System prompt                  500      yes
Current page content           600      yes (same page)
Sliding window (6 messages)    400      no
Concept map                    200      partial
─────────────────────────────────────────────────
Total                         1700
Cost                        ~$0.002 per message (GPT-5.4 mini)
```

### Doubt Chat (with backward reference)
```
Component                     Tokens    Cached?
─────────────────────────────────────────────────
Base context                  1700      partial
Retrieved lesson pages (x2)    800      no
─────────────────────────────────────────────────
Total                         2500
Cost                        ~$0.003 per message (GPT-5.4 mini)
```

---

## Build Order

### MVP (build now)
```
✓ pages collection, no embedding field yet
✓ doubt_messages collection
✓ Sliding window: last 6 messages via .find().sort().limit()
✓ Current page content always included in context
✓ Concept map from keyConcepts fields on topic documents
✗ No vector search yet
✗ No backward reference resolution yet

Doubt chat answers from:
  current page + recent history + concept map
  Good enough to validate the core product
```

### Post-MVP v1.1 (add vector search)
```
✓ Add embedding field to pages collection
✓ Generate embeddings async when pages are stored
✓ Create Atlas Vector Search index on pages
✓ Implement findRelevantPages()
✓ Add isBackwardReference() detection
✓ Inject past lesson pages when triggered

Doubt chat now answers from:
  current page + recent history + concept map + relevant past pages
  Backward references fully resolved
```

### Post-MVP v1.2 (Mode A — source upload)
```
✓ source_chunks collection with embedding field
✓ PDF / link / docx parsing pipeline
✓ Atlas Vector Search index on source_chunks
✓ findRelevantChunks() for page generation
✓ Full two-layer RAG operational

Page generation now uses:
  retrieved source chunks → AI generates → pages stored
```

### Post-MVP v1.3 (smart history)
```
✓ Embed doubt_messages on storage
✓ Semantic search over full doubt history
✓ Summarise doubt history when session exceeds 20 messages
✓ Compaction for very long sessions
```

---

## Important: Data Isolation in MongoDB

MongoDB has no row-level security. Every query must be scoped by userId or courseId. Never query a collection without one of these filters.

```typescript
// WRONG — returns data for all users
db.collection('pages').find({ topicId })

// CORRECT — scoped to this course (which belongs to one user)
db.collection('pages').find({ topicId, courseId })

// CORRECT — scoped to this user directly
db.collection('doubt_messages').find({ topicId, userId })
```

Add a middleware check in your API routes that verifies the requesting user owns the courseId in the request. If the course doesn't belong to them, return 403 before any DB query runs.

---

## Why This Is Better Than Standard RAG

Standard RAG retrieves raw source chunks to answer questions. The chunks are dense, academic, written for a general audience. The AI interprets them on the fly.

TruLurn retrieves lesson pages — content already:
- Written at the correct depth for this student
- Calibrated to the course's voice and style
- Built from what was established in previous subtopics
- Structured with the right examples for this field

When the AI retrieves a lesson page for a doubt response, it works with material the student has already read. It can say "as we covered in the decision trees section..." and be accurate. That is what makes TruLurn's doubt chat feel like a tutor who remembers what they taught — not a search engine that found something relevant.

**The lesson pages are not just content delivery. They are the memory corpus.**

---

*TruLurn · MEMORY.md · MongoDB edition*
*Read alongside PLAN.md, GENERATION.md, NAVIGATION.md, and CLAUDE.md*
