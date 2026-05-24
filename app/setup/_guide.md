# app/setup/ — Course Setup / Onboarding

> The entry point of the product. User describes what they want to learn.

---

## File

`setup/page.tsx`

---

## What It Does

1. User fills in:
   - **Topic** — what they want to learn (e.g. "Machine Learning")
   - **Goals** — what they want to be able to do (e.g. "Build and tune classification models")
   - **Mode** — only Mode B (AI as Teacher) is available in MVP

2. User submits → calls `POST /api/generate/course`

3. Page transitions to a **progress indicator** (not a spinner — an informative one):
   - "Designing your roadmap..."
   - "Generating lesson content..." (with topic names appearing as they complete)
   - "Creating quiz questions..."

4. On batch completion → redirects to `/learn/[courseId]`

---

## Components Used

- `<TopicInput />` — topic + goals form fields
- `<ModeSelector />` — Mode A vs Mode B (Mode A is grayed out / "Coming soon" in MVP)
- `<HallucinationWarning />` — visible banner: "Content is AI-generated from model knowledge. Verify critical facts."

---

## UX Notes

- Course generation is async (Batch API). The user should NOT be on a spinning screen.
- Show meaningful progress: which sections are done, estimated time remaining.
- Do not navigate away automatically while polling — let it poll on the page.
- If batch fails, show a clear error with a "Try again" button. Do not swallow errors silently.

---

## Polling Strategy

```
POST /api/generate/course → { batchId, courseId }
Poll GET /api/generate/status?batchId=[id] every 3–5 seconds
On status === 'complete' → redirect to /learn/[courseId]
On status === 'failed' → show error state
```
