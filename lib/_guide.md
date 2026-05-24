# lib/ — Server-Side Utilities & AI Clients

> All non-component logic lives here. Never import from `lib/` in Client Components  
> (except `lib/supabase.ts` browser client).

---

## Files

### `anthropic.ts`
Anthropic client singleton.  
```typescript
import Anthropic from '@anthropic-ai/sdk'
export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
```
**Used by:** All `/api/` routes that call Claude.

---

### `supabase.ts`
Exports two Supabase clients:
- `createServerClient()` — for Server Components and API routes (uses service role key)
- `createBrowserClient()` — for Client Components (uses anon key, respects RLS)

```typescript
// In API routes / Server Components:
import { createServerClient } from '@/lib/supabase'
const supabase = createServerClient()

// In Client Components:
import { createBrowserClient } from '@/lib/supabase'
const supabase = createBrowserClient()
```

---

### `roadmap.ts`
Pure roadmap state logic. No database calls — takes current state and quiz result, returns new states.

```typescript
export function computeRoadmapUpdate(
  topics: Topic[],
  quizResult: { topicId: string; overallLevel: number; passed: boolean; falseConfidence: boolean }
): { topicId: string; newState: TopicState }[]
```

**Logic rules:**
- L4+ passed → topic → `mastered`, unlock adjacent topics whose prerequisites are all mastered
- L2 passed → topic → `partial`
- Failed → topic → `unstable`, block progression
- False confidence → topic → `unstable`, check if prerequisite topics should also degrade
- Mastered topics can be downgraded — this is intentional

**This function is pure.** The API route (`/api/roadmap/update`) calls this and then writes results to the DB.

---

## prompts/
All prompt templates. See `lib/prompts/_guide.md`.
