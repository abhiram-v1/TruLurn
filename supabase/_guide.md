# supabase/ — Database Migrations & Config

---

## migrations/001_initial.sql

**Purpose:** The complete initial database schema for TruLurn MVP.  
**Run this once** when setting up a new Supabase project (or apply via Supabase CLI).

### Tables Created

| Table | Purpose |
|---|---|
| `courses` | One per course. Belongs to a user. Stores topic, goals, mode. |
| `topics` | All topics/subtopics. Nested via `parent_id`. Has `state` and `understanding_level`. |
| `pages` | Lesson content. One row per page per topic. Stored as markdown text. |
| `doubt_messages` | Chat history. Scoped to `topic_id`. Not global. |
| `quiz_questions` | Pre-generated question pool. 10 per topic. Includes `rubric`. |
| `quiz_attempts` | One per quiz session. Stores questions asked, user answers, and AI evaluation. |

### Security

All tables have **Row Level Security (RLS) enabled**.  
Policy: users can only read/write their own data.  
`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS — only use server-side in API routes.

---

## How to Apply

```bash
# Using Supabase CLI
supabase db push

# Or paste contents of 001_initial.sql into Supabase Dashboard → SQL Editor
```

---

## Adding Future Migrations

Name migration files sequentially:  
`002_add_edge_tracking.sql`  
`003_add_false_confidence_column.sql`  

Always write migrations as additive (add columns/tables). Never drop in a migration without explicit intent.

---

## Schema Source

Full schema SQL is in `PLAN_1.md` → "Database Schema" section.  
Copy it verbatim into `supabase/migrations/001_initial.sql` when initializing.
