# app/ — Next.js App Router

> All pages and API routes live here. Uses Next.js 14+ App Router conventions.

---

## Directory Map

```
app/
├── layout.tsx          ← Root layout: HTML shell, fonts, global CSS, Supabase session provider
├── page.tsx            ← Landing page / home dashboard (shows user's courses)
├── globals.css         ← CSS variables, base resets, font stack
│
├── (auth)/             ← Auth pages (grouped, no shared layout with main app)
│   ├── login/
│   └── signup/
│
├── setup/              ← Onboarding: user enters topic + goals, course generates
│
├── learn/              ← Main learning experience (three-panel layout)
│   └── [courseId]/
│       └── [topicId]/  ← Per-topic lesson view
│
├── quiz/               ← Quiz session (separate page, not embedded in learn)
│   └── [topicId]/
│
└── api/                ← All backend API routes (Next.js route handlers)
    ├── generate/
    ├── chat/
    ├── quiz/
    └── roadmap/
```

---

## Files to Create (Day 1–5)

| File | Day | Purpose |
|---|---|---|
| `layout.tsx` | 1 | Root layout, Supabase session, global CSS |
| `page.tsx` | 1 | Home/dashboard — list of user's courses |
| `globals.css` | 1 | CSS variables from COLOR_PALETTE.md |
| `(auth)/login/page.tsx` | 1 | Login form using Supabase Auth |
| `(auth)/signup/page.tsx` | 1 | Signup form using Supabase Auth |
| `setup/page.tsx` | 1 | Topic input + goals + course generation trigger |
| `learn/layout.tsx` | 2 | Three-panel shell (wraps all learn routes) |
| `learn/[courseId]/page.tsx` | 2 | Redirects to first active topic |
| `learn/[courseId]/[topicId]/page.tsx` | 2 | Main lesson view |
| `quiz/[topicId]/page.tsx` | 4 | Quiz session |

---

## Key Conventions

- All data fetching in Server Components where possible (App Router default)
- Client Components only when needed: streaming chat, interactive state, real-time updates
- Mark client components with `'use client'` at the top
- Never put API keys in client components — all AI calls go through `/api/` routes
