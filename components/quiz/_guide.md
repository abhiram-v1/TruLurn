# components/quiz/ — Quiz Components

---

## QuizSession.tsx
**Role:** Shell that manages the entire quiz flow as a state machine.  
**Props:**
```typescript
{
  topicId: string
  topicTitle: string
  questions: QuizQuestion[]   // 4–5 questions fetched from pool
}
```
**State machine:**
```
idle → answering → submitting → evaluating → result
```
**What it manages:**
- `answers` state: `Record<questionId, string>` — user's typed answers
- Calls `POST /api/quiz/evaluate` on submit
- Calls `POST /api/roadmap/update` after evaluation returns
- Passes results to `<QuizResult />`

**Client Component** (`'use client'`).

---

## QuizQuestion.tsx
**Role:** Renders a single question with a textarea for the user's answer.  
**Props:**
```typescript
{
  question: QuizQuestion
  index: number           // question number (1, 2, 3...)
  totalQuestions: number
  value: string           // controlled textarea value
  onChange: (value: string) => void
}
```
**What it renders:**
- Question type badge (Apply / Spot the Error / Explain)
- Question text — clear, well-spaced
- Textarea — tall enough for a full paragraph, no character limit shown
- Character minimum nudge if answer is too short (< 50 chars): "Tell us more — explain your reasoning."

**No hints.** No "Show answer." No multiple choice options. Open text only.

---

## QuizResult.tsx
**Role:** Shows evaluation feedback after quiz is scored.  
**Props:**
```typescript
{
  questions: QuizQuestion[]
  answers: Record<string, string>
  evaluations: Record<string, EvaluationResult>
  overallLevel: number
  passed: boolean
  topicStateChange: {
    from: TopicState
    to: TopicState
  }
  unlockedTopics: Topic[]   // topics newly unlocked by this quiz
}
```
**What it renders:**
- Overall result banner (passed/failed + new topic state with color)
- Per-question breakdown:
  - Question text
  - User's answer (quoted)
  - AI feedback (from `evaluation.feedback`)
  - Gap (from `evaluation.gap`) if present
  - Level achieved (shown as label, not number: "Mechanical", "Conceptual", etc.)
- If any `false_confidence: true` → show special warning panel
- Unlocked topics list if any were newly unlocked
- "Return to lesson" and "Retake quiz" buttons

**No score shown as a number.** No "You scored 3/5."
