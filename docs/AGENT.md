# TruLurn — Agent System

> The right sidebar is not a chatbox. It is an agent that answers questions,
> executes actions, tracks confusion, stores forward references, and silently
> adjusts page generation — all without the student knowing any of this is happening.
>
> This document is implementation-ready. Every function, type, prompt, and flow
> described here maps directly to code you write. Nothing is aspirational.

---

## Overview — Four Systems, One Sidebar

```
User sends a message
        ↓
┌─────────────────────────────────────────────────────┐
│  Step 1: Intent Classification                       │
│  Is this a question or an action?                    │
│  What kind of action or question?                    │
└───────────────────────┬─────────────────────────────┘
                        ↓
        ┌───────────────┴───────────────┐
        │                               │
   ACTION INTENT                  DOUBT INTENT
   Execute it                     Answer it
   (System 1)                     (DOUBTS_MEMORY.md)
        │                               │
        └───────────────┬───────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│  Step 2: Signal Detection (runs on every message)    │
│  Forward reference? Store it.                        │
│  Confusion signal? Log it.                           │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│  Step 3: State Update (async, background)            │
│  Update confusion score for this topic               │
│  Update student notes                                │
│  These feed into next page generation silently       │
└─────────────────────────────────────────────────────┘
```

---

## MongoDB Collections

```typescript
// agent_forward_refs
{
  _id:           ObjectId,
  userId:        string,
  courseId:      string,
  question:      string,        // original question verbatim
  concept:       string,        // extracted concept e.g. "rate of change"
  askedAt: {
    topicId:     string,
    subtopicId:  string,
    pageNumber:  number,
    subtopicTitle: string
  },
  targetTopicId: string,        // which topic covers this — extracted by AI
  surfaced:      boolean,       // has this been shown yet — default false
  createdAt:     Date
}

// agent_confusion_signals
{
  _id:         ObjectId,
  userId:      string,
  courseId:    string,
  topicId:     string,
  subtopicId:  string,
  concept:     string,          // what concept is confusing
  signalType:  string,          // see SignalType below
  severity:    number,          // 1 | 2 | 3
  createdAt:   Date
}

// agent_student_notes
{
  _id:            ObjectId,
  userId:         string,
  courseId:       string,
  strongConcepts: string[],     // consistently answered correctly
  weakConcepts:   string[],     // confusion signals accumulated here
  learningStyle:  string,       // inferred from behaviour
  forwardCurious: string[],     // concepts they asked about before covering
  openQuestions:  string[],     // questions not fully resolved
  lastUpdated:    Date
}
```

---

## System 1 — Intent Classification

### Intent Types

```typescript
// types/agent.ts

export type ActionIntent =
  | 'quiz_request'     // "give me a quiz" "test me" "I want to practice"
  | 'next_topic'       // "next topic" "move on" "I'm done" "continue"
  | 'prev_topic'       // "go back" "previous topic"
  | 'explain_again'    // "explain again" "didn't understand" "confused"
  | 'go_deeper'        // "go deeper" "more detail" "elaborate"
  | 'simplify'         // "simpler" "easier" "plain english"
  | 'show_example'     // "give me an example" "show me"
  | 'go_to_topic'      // "take me to backpropagation"

export type QuestionType =
  | 'general_knowledge'
  | 'current_page'
  | 'course_specific'

export type MessageIntent =
  | { kind: 'action'; type: ActionIntent }
  | { kind: 'doubt';  type: QuestionType }
```

### Heuristic Intent Detection

```typescript
// lib/agent/classifyIntent.ts

const ACTION_SIGNALS: Record<ActionIntent, string[]> = {
  quiz_request:  [
    'quiz', 'test me', 'test myself', 'question me',
    'give me a quiz', 'i want a quiz', 'practice questions',
    'ready to be tested', 'assess me'
  ],
  next_topic:    [
    'next topic', 'move on', 'continue', "i'm done",
    "i'm ready", 'finished this', 'next section',
    'what\'s next', 'lets move', 'go to next'
  ],
  prev_topic:    [
    'go back', 'previous topic', 'last topic',
    'back to', 'revisit', 'review previous'
  ],
  explain_again: [
    'explain again', 'didn\'t understand', 'don\'t understand',
    'confused', 'lost', 'say that again', 'another way',
    'not clear', 'try again', 'still don\'t get it'
  ],
  go_deeper:     [
    'go deeper', 'more detail', 'elaborate', 'expand on',
    'tell me more', 'in depth', 'deeper explanation'
  ],
  simplify:      [
    'simpler', 'simplify', 'too complex', 'easier',
    'plain english', 'dumb it down', 'basic version',
    'eli5', 'for a beginner'
  ],
  show_example:  [
    'give me an example', 'show me an example',
    'can you demonstrate', 'illustrate', 'concrete example',
    'real world example'
  ],
  go_to_topic:   [
    'take me to', 'go to', 'open', 'navigate to',
    'jump to', 'show me the', 'i want to see'
  ],
}

export function detectActionIntent(
  message: string
): ActionIntent | null {
  const m = message.toLowerCase().trim()

  for (const [intent, signals] of Object.entries(ACTION_SIGNALS)) {
    if (signals.some(signal => m.includes(signal))) {
      return intent as ActionIntent
    }
  }
  return null
}

export async function classifyIntent(
  message:  string,
  context:  SessionContext
): Promise<MessageIntent> {

  // Check for action intent first — heuristic, free
  const actionIntent = detectActionIntent(message)
  if (actionIntent) {
    return { kind: 'action', type: actionIntent }
  }

  // Not an action — classify as a doubt question
  // Uses the three-way classifier from DOUBTS_MEMORY.md
  const questionType = await classifyQuestion(
    message,
    context.currentPage.content,
    context.conceptMap
  )

  return { kind: 'doubt', type: questionType }
}
```

### Action Handlers

```typescript
// lib/agent/actions.ts

export async function executeAction(
  intent:  ActionIntent,
  message: string,
  context: SessionContext
): Promise<AgentResponse> {

  switch (intent) {

    case 'quiz_request':
      // Trigger quiz for current topic
      // Returns a UI action, not a text response
      return {
        type: 'ui_action',
        action: 'open_quiz',
        topicId: context.topicId,
        message: 'Opening quiz for this topic.'
      }

    case 'next_topic':
      // Check if current topic is completable
      const canAdvance = await checkTopicCompletion(context.topicId, context.userId)
      if (!canAdvance) {
        return {
          type: 'text',
          message: `You haven't completed the quiz for this topic yet.
                    Finish the quiz first, or I can open it now.`
        }
      }
      return {
        type: 'ui_action',
        action: 'next_topic',
        message: 'Moving to the next topic.'
      }

    case 'prev_topic':
      return {
        type: 'ui_action',
        action: 'prev_topic',
        message: 'Going back to the previous topic.'
      }

    case 'explain_again':
      // Log as confusion signal before regenerating
      await logConfusionSignal({
        userId:     context.userId,
        courseId:   context.courseId,
        topicId:    context.topicId,
        subtopicId: context.subtopicId,
        concept:    context.currentPage.subtopicTitle,
        signalType: 'explain_again_request',
        severity:   2
      })
      // Regenerate current page with different approach
      return {
        type: 'ui_action',
        action: 'regenerate_page',
        pageId:    context.pageId,
        approach:  'different',
        message:   'Regenerating this page with a different approach.'
      }

    case 'go_deeper':
      return {
        type: 'ui_action',
        action: 'regenerate_page',
        pageId:    context.pageId,
        approach:  'deeper',
        message:   'Adding more depth to this page.'
      }

    case 'simplify':
      return {
        type: 'ui_action',
        action: 'regenerate_page',
        pageId:    context.pageId,
        approach:  'simpler',
        message:   'Simplifying this page.'
      }

    case 'show_example':
      return {
        type: 'ui_action',
        action: 'append_example',
        pageId:    context.pageId,
        message:   'Adding an example.'
      }

    case 'go_to_topic':
      const topicName = await extractTopicName(message, context.courseId)
      if (!topicName) {
        return {
          type: 'text',
          message: 'Which topic would you like to go to? I can navigate to any topic in your roadmap.'
        }
      }
      return {
        type: 'ui_action',
        action: 'navigate_to_topic',
        topicName,
        message: `Navigating to ${topicName}.`
      }
  }
}

// Extract topic name from message like "take me to backpropagation"
async function extractTopicName(
  message:  string,
  courseId: string
): Promise<string | null> {

  // Get all topic titles in this course
  const topics = await db.collection('topics')
    .find({ courseId })
    .project({ title: 1 })
    .toArray()

  const topicTitles = topics.map((t: any) => t.title.toLowerCase())

  // Check if message contains a topic title
  const found = topicTitles.find(title =>
    message.toLowerCase().includes(title)
  )

  return found ?? null
}
```

---

## System 2 — Forward Reference Tracking

### Detection Prompt

The doubt chat system prompt gets this addition:

```typescript
// Add to DOUBT_SYSTEM_PROMPT for course_specific and general_knowledge types

const FORWARD_REF_INSTRUCTION = `
If the student asks about a concept that will be covered in a FUTURE topic
(not yet reached in their roadmap), do the following:

1. Answer briefly — acknowledge the question, give a one sentence preview
2. Say it will be covered properly when they reach [topic name]
3. End your response with this exact tag on its own line:
   FORWARD_REF: [concept] | [future_topic_title]

Example response ending:
"...we will cover this properly when we reach derivatives.
FORWARD_REF: rate_of_change | derivatives"

If the question is about something already covered or on the current page,
do NOT include the FORWARD_REF tag.
Only use it when the concept is genuinely ahead in the roadmap.
`
```

### Detection and Storage

```typescript
// lib/agent/forwardRefs.ts

const FORWARD_REF_TAG = 'FORWARD_REF:'

export function extractForwardRef(
  response: string
): { cleanResponse: string; ref: { concept: string; targetTopic: string } | null } {

  const lines = response.split('\n')
  const tagLine = lines.find(l => l.trim().startsWith(FORWARD_REF_TAG))

  if (!tagLine) {
    return { cleanResponse: response, ref: null }
  }

  // Remove the tag line from displayed response
  const cleanResponse = lines
    .filter(l => !l.trim().startsWith(FORWARD_REF_TAG))
    .join('\n')
    .trim()

  // Parse the tag
  const tagContent = tagLine.replace(FORWARD_REF_TAG, '').trim()
  const [concept, targetTopic] = tagContent.split('|').map(s => s.trim())

  if (!concept || !targetTopic) {
    return { cleanResponse, ref: null }
  }

  return { cleanResponse, ref: { concept, targetTopic } }
}

export async function storeForwardRef(
  userId:    string,
  courseId:  string,
  question:  string,
  concept:   string,
  targetTopicTitle: string,
  askedAt:   { topicId: string; subtopicId: string; pageNumber: number; subtopicTitle: string }
) {
  // Find the target topic ID by title
  const targetTopic = await db.collection('topics').findOne({
    courseId,
    title: { $regex: new RegExp(targetTopicTitle, 'i') }
  })

  if (!targetTopic) return   // topic not found in roadmap, skip

  await db.collection('agent_forward_refs').insertOne({
    userId,
    courseId,
    question,
    concept,
    askedAt,
    targetTopicId: targetTopic._id.toString(),
    surfaced: false,
    createdAt: new Date()
  })
}
```

### Surfacing at the Right Moment

```typescript
// lib/agent/surfaceForwardRefs.ts

// Called when student opens a new topic
export async function getForwardRefsForTopic(
  userId:  string,
  topicId: string
): Promise<ForwardRef[]> {

  return db.collection('agent_forward_refs').find({
    userId,
    targetTopicId: topicId,
    surfaced: false
  }).toArray()
}

// Mark as surfaced after injecting into page generation
export async function markSurfaced(refIds: string[]) {
  await db.collection('agent_forward_refs').updateMany(
    { _id: { $in: refIds.map(id => new ObjectId(id)) } },
    { $set: { surfaced: true } }
  )
}
```

### Injection into Page Generation

```typescript
// lib/generation/buildPagePrompt.ts
// Add this to the first page of a topic if forward refs exist

export async function getForwardRefBlock(
  userId:  string,
  topicId: string
): Promise<string> {

  const refs = await getForwardRefsForTopic(userId, topicId)
  if (refs.length === 0) return ''

  // Mark as surfaced
  await markSurfaced(refs.map(r => r._id.toString()))

  const refList = refs.map(r =>
    `  - "${r.question}" (asked while studying ${r.askedAt.subtopicTitle})`
  ).join('\n')

  return `
STUDENT PRIOR CURIOSITY:
The student asked about concepts in this topic before reaching it:
${refList}

If it is natural to do so, acknowledge this connection in your explanation.
For example: "You may have been wondering about this when we were covering X —
this is exactly what formalises that intuition."
Do not force it. Only include if it reads naturally.
Do not say "I remember you asked" — just weave it in.
  `.trim()
}
```

---

## System 3 — Confusion Detection

### Signal Types and Severities

```typescript
// types/agent.ts

export type SignalType =
  | 'repeated_question'      // asked about same concept 2+ times
  | 'explain_again_request'  // explicitly asked to re-explain
  | 'wrong_quiz_answer'      // failed quiz question on this concept
  | 'hint_dependency'        // needed hints to answer quiz
  | 'slow_page_time'         // spent 3x average time on a page
  | 'false_confidence'       // claimed understanding, failed transfer quiz

export const SIGNAL_SEVERITY: Record<SignalType, number> = {
  repeated_question:     1,
  explain_again_request: 2,
  wrong_quiz_answer:     2,
  hint_dependency:       1,
  slow_page_time:        1,
  false_confidence:      3,   // heaviest signal
}
```

### Logging Signals

```typescript
// lib/agent/confusionSignals.ts

export async function logConfusionSignal(signal: {
  userId:     string
  courseId:   string
  topicId:    string
  subtopicId: string
  concept:    string
  signalType: SignalType
  severity?:  number
}) {
  const severity = signal.severity ?? SIGNAL_SEVERITY[signal.signalType]

  await db.collection('agent_confusion_signals').insertOne({
    ...signal,
    severity,
    createdAt: new Date()
  })
}

// Detect repeated questions passively
// Called after every doubt message is stored
export async function checkRepeatedQuestion(
  userId:    string,
  topicId:   string,
  concept:   string
) {
  // Has this concept been asked about before in this topic?
  const existing = await db.collection('doubt_messages').countDocuments({
    userId,
    topicId,
    // rough check — look for concept keyword in past messages
    content: { $regex: new RegExp(concept, 'i') }
  })

  if (existing >= 2) {
    await logConfusionSignal({
      userId,
      courseId: '',   // fill from context
      topicId,
      subtopicId: '',
      concept,
      signalType: 'repeated_question',
    })
  }
}
```

### Computing the Confusion Score

```typescript
// lib/agent/confusionScore.ts

export async function getConfusionScore(
  userId:  string,
  topicId: string
): Promise<{ score: number; weakConcepts: string[] }> {

  const signals = await db.collection('agent_confusion_signals')
    .find({ userId, topicId })
    .sort({ createdAt: -1 })
    .toArray()

  if (signals.length === 0) {
    return { score: 0, weakConcepts: [] }
  }

  // Recency weight — signals from last 30 mins count more
  function recencyWeight(createdAt: Date): number {
    const minsAgo = (Date.now() - createdAt.getTime()) / 60000
    if (minsAgo < 30)  return 1.5
    if (minsAgo < 120) return 1.0
    return 0.6
  }

  const score = signals.reduce((acc, s) => {
    return acc + (s.severity * recencyWeight(s.createdAt))
  }, 0)

  // Extract which concepts are causing confusion
  const conceptCounts: Record<string, number> = {}
  for (const s of signals) {
    conceptCounts[s.concept] = (conceptCounts[s.concept] ?? 0) + s.severity
  }

  const weakConcepts = Object.entries(conceptCounts)
    .filter(([_, count]) => count >= 2)
    .sort(([_, a], [__, b]) => b - a)
    .map(([concept]) => concept)

  return {
    score: Math.min(Math.round(score), 10),
    weakConcepts
  }
}
```

---

## System 4 — Dynamic Page Adjustment

### The Adjustment Block

Injected into page generation prompts silently. Student never sees this. They just notice the explanation works better.

```typescript
// lib/agent/adjustmentBlock.ts

export function buildAdjustmentBlock(
  score:          number,
  weakConcepts:   string[],
  forwardRefBlock: string
): string {

  const parts: string[] = []

  // Forward references (from System 2)
  if (forwardRefBlock) {
    parts.push(forwardRefBlock)
  }

  // Confusion adjustments (from System 3)
  if (score >= 3 && weakConcepts.length > 0) {
    const conceptList = weakConcepts.join(', ')

    if (score <= 5) {
      parts.push(`
STUDENT CONTEXT:
The student has shown some difficulty with: ${conceptList}.
Add one extra concrete example for these concepts if they appear on this page.
Do not mention the difficulty. Just add the example naturally.
      `.trim())
    }

    else if (score <= 8) {
      parts.push(`
STUDENT CONTEXT:
The student is struggling with: ${conceptList}.
If these concepts appear on this page:
  - Use a simpler analogy before the formal explanation
  - Add two concrete examples minimum
  - Approach from a different angle than standard
Do not mention the difficulty or that you are adjusting.
      `.trim())
    }

    else {
      parts.push(`
STUDENT CONTEXT:
The student has significant confusion with: ${conceptList}.
For this page:
  - Start from the simplest possible foundation
  - Prioritise depth over coverage — explain one thing perfectly
  - Use the most intuitive analogy you can find
  - Do not assume prior familiarity with these concepts even if
    they were covered earlier
Do not mention the difficulty. Do not say you are simplifying.
Just teach it better.
      `.trim())
    }
  }

  return parts.join('\n\n')
}
```

### Plugging Into Page Generation

```typescript
// lib/generation/generatePage.ts

export async function generatePage(
  roadmap:       MiniRoadmap,
  subtopic:      Subtopic,
  pageNumber:    number,
  pageFocus:     string,
  userId:        string,
  courseId:      string
) {
  // Get confusion state for this topic
  const { score, weakConcepts } = await getConfusionScore(
    userId,
    subtopic.topicId
  )

  // Get forward refs if this is page 1 of a new topic
  const forwardRefBlock = pageNumber === 1
    ? await getForwardRefBlock(userId, subtopic.topicId)
    : ''

  // Build the adjustment block
  const adjustmentBlock = buildAdjustmentBlock(
    score,
    weakConcepts,
    forwardRefBlock
  )

  // Generate the page — adjustment block added to system prompt
  return complete('page_generation', `
    ${BASE_SYSTEM_PROMPT}
    ${roadmap.stylePrompt}
    ${DEPTH_RULES}
    ${adjustmentBlock}
  `, `
    ${buildMiniRoadmapContext(roadmap)}
    ${YOU_ARE_HERE_POINTER(subtopic, pageNumber, pageFocus)}
    Write page ${pageNumber} now.
  `)
}
```

---

## Student Notes — Cross-Session Memory

Updated at end of every session. Read at start of every session. Keeps the tutor oriented across multiple visits.

```typescript
// lib/agent/studentNotes.ts

// Called when user leaves a session (page unload or inactivity timeout)
export async function updateStudentNotes(
  userId:   string,
  courseId: string
) {
  const [
    confusionSignals,
    quizAttempts,
    doubtMessages,
    forwardRefs
  ] = await Promise.all([
    db.collection('agent_confusion_signals')
      .find({ userId, courseId }).sort({ createdAt: -1 }).limit(50).toArray(),
    db.collection('quiz_attempts')
      .find({ userId, courseId }).sort({ createdAt: -1 }).limit(10).toArray(),
    db.collection('doubt_messages')
      .find({ userId, courseId }).sort({ createdAt: -1 }).limit(30).toArray(),
    db.collection('agent_forward_refs')
      .find({ userId, courseId }).toArray()
  ])

  // Build summary using cheap model
  const summary = await complete(
    'relevance_check',   // Haiku
    `You update a student learning profile.
Respond ONLY with valid JSON matching the schema exactly.
No preamble. No explanation.`,
    `
Confusion signals (recent): ${JSON.stringify(confusionSignals.slice(0, 20))}
Quiz results (recent): ${JSON.stringify(quizAttempts.slice(0, 5))}
Doubt messages (recent): ${JSON.stringify(doubtMessages.map(m => m.content).slice(0, 20))}
Forward references: ${JSON.stringify(forwardRefs.map(r => r.concept))}

Update this student profile:
{
  "strongConcepts":  ["concepts they consistently get right"],
  "weakConcepts":    ["concepts they struggle with"],
  "learningStyle":   "one sentence describing how they learn best based on their questions",
  "forwardCurious":  ["concepts they asked about before covering"],
  "openQuestions":   ["questions that were not fully resolved"]
}
    `
  )

  const notes = JSON.parse(summary)

  await db.collection('agent_student_notes').updateOne(
    { userId, courseId },
    { $set: { ...notes, lastUpdated: new Date() } },
    { upsert: true }
  )
}

// Read at session start — inject into first page generation of session
export async function getStudentNotes(
  userId:   string,
  courseId: string
): Promise<string> {

  const notes = await db.collection('agent_student_notes').findOne(
    { userId, courseId }
  )

  if (!notes) return ''

  return `
STUDENT PROFILE (from previous sessions):
Strong concepts:   ${notes.strongConcepts?.join(', ') || 'none yet'}
Weak concepts:     ${notes.weakConcepts?.join(', ') || 'none yet'}
Learning style:    ${notes.learningStyle || 'not yet determined'}
Open questions:    ${notes.openQuestions?.join(', ') || 'none'}

Use this to calibrate your explanation style for this student.
Do not reference this profile explicitly in your response.
  `.trim()
}
```

---

## Main Message Handler — Full Flow

```typescript
// lib/agent/handleMessage.ts

export async function handleMessage(
  userId:   string,
  courseId: string,
  topicId:  string,
  subtopicId: string,
  pageId:   string,
  message:  string
): Promise<AgentResponse> {

  // 1. Fetch session context (parallel)
  const [currentPage, conceptMap, recentHistory] = await Promise.all([
    db.collection('pages').findOne({ _id: new ObjectId(pageId) }),
    getConceptMap(courseId),
    db.collection('doubt_messages')
      .find({ topicId, userId })
      .sort({ createdAt: -1 })
      .limit(6)
      .toArray()
      .then(msgs => msgs.reverse())
  ])

  const context: SessionContext = {
    userId, courseId, topicId, subtopicId, pageId,
    currentPage, conceptMap, recentHistory
  }

  // 2. Classify intent
  const intent = await classifyIntent(message, context)

  let responseText: string
  let uiAction: UIAction | null = null

  if (intent.kind === 'action') {
    // 3a. Execute action
    const result = await executeAction(intent.type, message, context)

    if (result.type === 'ui_action') {
      uiAction = result
      responseText = result.message
    } else {
      responseText = result.message
    }

  } else {
    // 3b. Answer doubt using three-way system (DOUBTS_MEMORY.md)
    const rawResponse = await answerDoubt(
      intent.type,
      message,
      context
    )

    // 4. Extract forward reference if present
    const { cleanResponse, ref } = extractForwardRef(rawResponse)
    responseText = cleanResponse

    // Store forward ref if found
    if (ref) {
      await storeForwardRef(
        userId, courseId, message,
        ref.concept, ref.targetTopic,
        {
          topicId,
          subtopicId,
          pageNumber: currentPage.pageNumber,
          subtopicTitle: currentPage.subtopicTitle
        }
      )
    }
  }

  // 5. Detect confusion signals (async — don't await)
  detectAndLogSignals(userId, courseId, topicId, subtopicId, message, intent)

  // 6. Store message (async — don't await)
  storeMessages(userId, courseId, topicId, currentPage.pageNumber, message, responseText)

  // 7. Return response immediately
  return {
    text: responseText,
    uiAction
  }
}
```

### Signal Detection (runs async, never blocks response)

```typescript
// lib/agent/detectSignals.ts

export async function detectAndLogSignals(
  userId:     string,
  courseId:   string,
  topicId:    string,
  subtopicId: string,
  message:    string,
  intent:     MessageIntent
) {
  // Signal: explicit re-explain request
  if (intent.kind === 'action' && intent.type === 'explain_again') {
    await logConfusionSignal({
      userId, courseId, topicId, subtopicId,
      concept: 'current page',
      signalType: 'explain_again_request',
      severity: 2
    })
    return
  }

  if (intent.kind !== 'doubt') return

  // Signal: repeated question detection
  // Extract concept from message (simple keyword approach for MVP)
  const conceptKeywords = extractConcepts(message)
  for (const concept of conceptKeywords) {
    await checkRepeatedQuestion(userId, topicId, concept)
  }
}

// Simple concept extraction for MVP
// Upgrade to NER or Haiku call post-MVP
function extractConcepts(message: string): string[] {
  // Remove common words, return meaningful terms
  const stopWords = new Set([
    'what', 'how', 'why', 'when', 'is', 'are', 'the',
    'a', 'an', 'this', 'that', 'does', 'do', 'can',
    'could', 'would', 'should', 'will', 'about', 'with'
  ])

  return message
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(' ')
    .filter(w => w.length > 3 && !stopWords.has(w))
    .slice(0, 5)   // max 5 concepts per message
}
```

---

## Quiz Signal Integration

When quiz results come back, log them as confusion signals:

```typescript
// lib/quiz/processResults.ts — add this after quiz evaluation

export async function processQuizSignals(
  userId:     string,
  courseId:   string,
  topicId:    string,
  subtopicId: string,
  evaluation: EvaluationResult[]
) {
  for (const result of evaluation) {
    if (!result.passed) {
      await logConfusionSignal({
        userId, courseId, topicId, subtopicId,
        concept: result.gap ?? 'unknown',
        signalType: 'wrong_quiz_answer',
        severity: 2
      })
    }

    if (result.false_confidence) {
      await logConfusionSignal({
        userId, courseId, topicId, subtopicId,
        concept: result.gap ?? 'unknown',
        signalType: 'false_confidence',
        severity: 3
      })
    }
  }
}
```

---

## What the Student Experiences

```
What student does:              What actually happens:

Types "give me a quiz"          Intent classified as quiz_request
                                executeAction opens quiz view
                                No confusion — straightforward

Types "explain again"           Intent classified as explain_again
                                Confusion signal logged (severity 2)
                                Page regenerated with different approach
                                Score increases for this topic

Asks about rate of change       AI answers briefly
during limits lesson            FORWARD_REF extracted silently
                                Stored with pointer to derivatives topic
                                Student sees clean answer, no tag

Reaches derivatives topic       Forward ref retrieved on page 1
                                Page generation prompt includes:
                                "student asked about rate of change earlier"
                                Page naturally weaves that connection in
                                Student: "how did it know I was thinking about this?"

Asks same thing 3 times         repeated_question signal logged 3x
                                Confusion score increases
                                Next page generation gets adjustment block
                                Next page uses simpler analogy + more examples
                                Student notices explanation is clearer

Fails quiz, claims understood   false_confidence signal logged (severity 3)
                                Score jumps significantly
                                Next pages are restructured from ground up
                                Student doesn't know why — just works better
```

---

## Frontend — UI Action Handling

The agent returns two types of responses. Frontend must handle both.

```typescript
// types/agent.ts

export interface AgentResponse {
  text:      string         // always present — shown in sidebar
  uiAction:  UIAction | null
}

export type UIAction =
  | { action: 'open_quiz';          topicId: string }
  | { action: 'next_topic' }
  | { action: 'prev_topic' }
  | { action: 'regenerate_page';   pageId: string; approach: string }
  | { action: 'append_example';    pageId: string }
  | { action: 'navigate_to_topic'; topicName: string }
```

```tsx
// components/learn/DoubtChat.tsx

async function sendMessage(message: string) {
  const response = await fetch('/api/agent/message', {
    method: 'POST',
    body: JSON.stringify({ message, ...sessionContext })
  })

  const data: AgentResponse = await response.json()

  // Always show the text response in sidebar
  addMessage({ role: 'assistant', content: data.text })

  // Execute UI action if present
  if (data.uiAction) {
    handleUIAction(data.uiAction)
  }
}

function handleUIAction(action: UIAction) {
  switch (action.action) {
    case 'open_quiz':
      router.push(`/quiz/${action.topicId}`)
      break
    case 'next_topic':
      advanceToNextTopic()
      break
    case 'prev_topic':
      goToPreviousTopic()
      break
    case 'regenerate_page':
      triggerPageRegeneration(action.pageId, action.approach)
      break
    case 'append_example':
      triggerAppendExample(action.pageId)
      break
    case 'navigate_to_topic':
      navigateByName(action.topicName)
      break
  }
}
```

---

## Build Order

### MVP
```
✓ Intent classification — heuristics only (no AI classifier yet)
✓ Action handlers: quiz_request, next_topic, explain_again, go_deeper, simplify
✓ Doubt routing to DOUBTS_MEMORY.md three-way system
✓ Store doubt messages to DB
✗ Forward reference tracking — post-MVP
✗ Confusion signals — post-MVP
✗ Dynamic page adjustment — post-MVP
✗ Student notes — post-MVP

Why: validate the agentic sidebar first.
     Make sure actions work reliably before adding intelligence.
```

### Post-MVP v1.1
```
✓ Forward reference detection + storage
✓ Forward reference surfacing on topic open
✓ Injection into page generation
```

### Post-MVP v1.2
```
✓ Confusion signal logging (all types)
✓ Confusion score calculation
✓ Dynamic adjustment block in page generation
✓ Quiz signals fed into confusion system
```

### Post-MVP v1.3
```
✓ Student notes — session end update
✓ Student notes — session start injection
✓ AI classifier for ambiguous intent (Haiku)
✓ Full cross-session memory operational
```

---

## Rules

- Actions execute immediately — never ask the user to confirm simple actions
- FORWARD_REF tag is always stripped before showing response to user
- Confusion signals never surface to the user in any form
- Adjustment block is never shown to the user — only injected into prompts
- Student notes are never shown to the user — only used for generation context
- All signal detection and storage is async — never blocks the response
- UI actions are executed client-side — API returns the action type, frontend executes
- go_to_topic only works for unlocked topics — locked topics return a message explaining what to complete first

---

*TruLurn · AGENT.md · Part of the technical masterplan*
*Read alongside PLAN.md, MEMORY.md, GENERATION.md, DOUBTS_MEMORY.md, and CLAUDE.md*
