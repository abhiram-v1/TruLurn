# types/ — TypeScript Type Definitions

> All shared types live in `types/index.ts`. Import from here everywhere.  
> Never define types inline in component files if they're used in more than one place.

---

## File: `types/index.ts`

### Core Types

```typescript
// Union types
type CourseMode        = 'ai_teacher' | 'source_grounded'
type TopicState        = 'locked' | 'active' | 'done' | 'unstable' | 'partial' | 'functional' | 'mastered'
type UnderstandingLevel = 1 | 2 | 3 | 4 | 5
type QuestionType      = 'apply' | 'spot_error' | 'explain'
```

### Database Entity Types

| Type | Maps to table |
|---|---|
| `Course` | `courses` |
| `Topic` | `topics` (with optional joined `pages[]` and `children[]`) |
| `Page` | `pages` |
| `DoubtMessage` | `doubt_messages` |
| `QuizQuestion` | `quiz_questions` |
| `QuizAttempt` | `quiz_attempts` |

### Result Types

| Type | Used by |
|---|---|
| `EvaluationResult` | `/api/quiz/evaluate` response, `QuizResult.tsx` |

---

## Type Rules

- Always use `string` for UUIDs (not `number`)
- Nullable fields use `T | null`, not `T | undefined` (matches Supabase nulls)
- Joined/computed fields are marked with `// joined` comment and are always optional
- Never use `any` — use `unknown` and narrow it

---

## Full Type Reference (index.ts content)

See `PLAN_1.md` → "TypeScript Types" section for the full type definitions.  
Copy them verbatim when creating `types/index.ts`.
