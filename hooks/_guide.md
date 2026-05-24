# hooks/ — React Custom Hooks

> Client-side data fetching and state management hooks.  
> All hooks are Client-side only (`'use client'`).

---

## `useCourse.ts`

**Purpose:** Fetches and caches course data (topics, roadmap state) for the learn view.  
**Used by:** `ThreePanelLayout.tsx`, `MiniRoadmap.tsx`

```typescript
function useCourse(courseId: string): {
  course: Course | null
  topics: Topic[]
  isLoading: boolean
  error: Error | null
  refetch: () => void   // called after roadmap updates
}
```

**Notes:**
- Fetches topics with their state from Supabase
- `refetch()` is called by `QuizResult.tsx` after `POST /api/roadmap/update` completes
- Should use React `cache` or SWR for deduplication

---

## `useDoubtChat.ts`

**Purpose:** Manages doubt chat message state and streaming.  
**Used by:** `DoubtChat.tsx`

```typescript
function useDoubtChat(topicId: string, pageNumber: number, pageContent: string): {
  messages: DoubtMessage[]
  isStreaming: boolean
  send: (message: string) => Promise<void>
  clearAndLoad: (newTopicId: string) => void   // called on topic change
}
```

**Notes:**
- Loads existing messages from Supabase on mount (`doubt_messages` for `topicId`)
- `send()` calls `POST /api/chat/doubt` and streams the response
- Optimistically appends the user message before the response arrives
- Handles streaming via `ReadableStream` / `TextDecoder`
- `clearAndLoad()` is called when the user navigates to a different topic

---

## `useQuiz.ts`

**Purpose:** Manages quiz session state.  
**Used by:** `QuizSession.tsx`

```typescript
function useQuiz(topicId: string): {
  questions: QuizQuestion[]
  answers: Record<string, string>
  setAnswer: (questionId: string, value: string) => void
  submit: () => Promise<void>
  evaluations: Record<string, EvaluationResult> | null
  overallLevel: UnderstandingLevel | null
  passed: boolean | null
  isEvaluating: boolean
  phase: 'answering' | 'evaluating' | 'result'
}
```

**Notes:**
- Questions are fetched from Supabase (`quiz_questions` for `topicId`), limited to 4–5
- `submit()` calls `POST /api/quiz/evaluate` then `POST /api/roadmap/update`
- After roadmap update, calls `useCourse.refetch()` to refresh roadmap state in the learn view
