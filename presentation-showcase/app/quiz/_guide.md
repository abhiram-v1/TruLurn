# app/quiz/ — Quiz Session

> The most important feature. This is the only source of ground truth about what the user understands.

---

## File

`quiz/[topicId]/page.tsx`

---

## What It Does

1. Fetches 4–5 questions from the pre-generated pool (`quiz_questions` table for this topic)
2. Serves questions one at a time (or all at once with scroll — TBD)
3. User types open-ended answers (no multiple choice, ever)
4. On submit → calls `POST /api/quiz/evaluate`
5. Shows `<QuizResult />` with honest feedback per question
6. On result → calls `POST /api/roadmap/update` to update topic state
7. User returns to lesson with updated roadmap

---

## Question Types

| Type | What it tests | Example |
|---|---|---|
| `apply` | Transfer (L4) | "Your model has high train accuracy, low test accuracy. What does this tell you about regularization?" |
| `spot_error` | Conceptual (L3) | "A student says X. What's wrong?" |
| `explain` | Intuitive (L5) | "Explain gradient descent to someone who only knows basic algebra." |

Every quiz session must include all three types. Never serve only one type.

---

## Components Used

- `<QuizSession />` — shell, manages question state and navigation
- `<QuizQuestion />` — renders one question + textarea for answer
- `<QuizResult />` — shows evaluation feedback per question + overall result + roadmap change preview

---

## Evaluation Response Shape

```typescript
{
  level: 1 | 2 | 3 | 4 | 5,
  passed: boolean,
  feedback: string,     // specific, honest — "You described the procedure but not why it works"
  gap: string | null,   // "You're missing the concept of variance in the bias-variance tradeoff"
  false_confidence: boolean
}
```

---

## Roadmap Outcomes (displayed on result screen)

| Outcome | What user sees |
|---|---|
| L4+ passed | "Topic mastered. [Next topic] is now unlocked." |
| L2 passed | "Partial understanding. Conceptual questions queued for next session." |
| Failed | "Topic marked unstable. Here's what to review: [gap]" |
| False confidence | "You felt confident, but the answer shows a gap in [gap]. Topic blocked until you revisit." |

---

## UX Rules

- Show each question clearly, one focus at a time
- No timer — this is mastery, not speed
- Textarea must have enough height for a full paragraph answer
- "Submit" only available once all questions have been answered
- After submit, show a loading state while evaluation runs (Sonnet takes 2–5 seconds)
- Results are shown all at once after evaluation completes, not per-question as they stream
