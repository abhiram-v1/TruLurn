# TruLurn — Claude Code Instructions

> Read this before touching any file. This is the law of the codebase.

---

## What This Project Is

TruLurn is an AI-Guided Mastery System. It is NOT a chatbot, NOT a tutor, NOT "ChatGPT with folders."
It is a structured learning OS that tracks *cognitive state* — what users actually understand, not what they clicked.

**Product name: TruLurn.** Never call it Lurnex or anything else.

Full product spec: `PLAN_1.md` — read it completely before writing any feature.
Architecture reference: `docs/ARCHITECTURE.md`
Change log: `docs/CHANGELOG.md` — update this every time you modify a file.

---

## The Three Non-Negotiable Rules

1. **The middle panel (lesson) NEVER has a text input.** Not now, not ever. If you are adding a text input to the lesson panel, you are wrong.
2. **The doubt chat (right panel) is ALWAYS scoped to the current topic.** Never let it bleed into other topics or sessions.
3. **No purple/violet gradients, neon glows, glassmorphism, or "AI startup" aesthetics.** See design rules below.

---

## Color Palette (Final — Use Exactly These)

| Role | Hex | Name |
|---|---|---|
| Background primary | `#fdf7ed` | Off-white / warm cream |
| Background secondary | `#f4e3b2` | Sand |
| Text primary | `#050517` | Near-black |
| Accent | `#d36d4a` | Terracotta |
| Border / secondary text | `#d3d5d7` | Neutral gray |

CSS variables to use:
```css
--color-bg-primary:    #fdf7ed;
--color-bg-secondary:  #f4e3b2;
--color-text-primary:  #050517;
--color-accent:        #d36d4a;
--color-border:        #d3d5d7;
--color-text-secondary: #7a7a7a; /* derived */
```

**Do not invent additional colors.** Do not add "complementary" shades not listed above.

Topic state colors (these are the only exception — semantic only):
```
Unstable  → red   (#dc2626 or similar)
Partial   → amber (#d97706)
Functional → blue (#2563eb)
Mastered  → green (#16a34a)
```

---

## Typography Rules

```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;

--text-xs:   11px;
--text-sm:   13px;
--text-base: 15px;
--text-lg:   18px;
--text-xl:   22px;
--text-2xl:  28px;

/* Two weights ONLY */
font-weight: 400;  /* body text */
font-weight: 500;  /* headings, labels, emphasis */
/* NEVER use 600, 700, 800 */
```

---

## Design Inspiration

Linear, Notion, Raycast. Flat surfaces, generous whitespace, thin 0.5–1px borders.
NOT: any AI startup landing page, glassy cards, neon, animated backgrounds.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend + Backend | Next.js 14+ App Router |
| Styling | Tailwind CSS (utility classes only) |
| Database + Auth | Supabase (Postgres + Auth + Storage) |
| AI | Anthropic SDK |
| Hosting | Vercel |

---

## AI Model Tiers

| Task | Model | Method |
|---|---|---|
| Course + lesson + quiz generation | `claude-opus-4-6` | Batch API (once at setup) |
| Doubt chat | `claude-sonnet-4-6` | Streaming |
| Page rewrites (simplify/deeper) | `claude-sonnet-4-6` | Standard |
| Quiz answer evaluation | `claude-sonnet-4-6` | Standard |
| Relevance gating | `claude-haiku-4-5-20251001` | Standard (fast) |

**Cost target: $0.05–$0.15 per active user hour.**

---

## Environment Variables

```bash
ANTHROPIC_API_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=    # server-side only, never expose to client
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## MVP Build Order (Do Not Skip Ahead)

- **Day 1:** Supabase schema + auth + setup page + course generation API (Batch API)
- **Day 2:** Three-panel layout + mini roadmap + paginated lessons + page nav
- **Day 3:** Doubt chat + context locking + relevance check + streaming
- **Day 4:** Quiz page + question serving + evaluation API + roadmap state update
- **Day 5:** Polish — page controls, locked topic enforcement, error/loading states

---

## What Is NOT in MVP

Do not build any of these until the core loop is working:
- Connection graph / knowledge graph
- Inline text rewrite (select → prompt bar)
- False confidence detection
- Mode A (file upload / PDF parsing)
- Export (PDF, Markdown, Flashcards)
- Spaced repetition
- Bridge lessons
- Pricing / payments

---

## After Every Change

Update `docs/CHANGELOG.md` with:
- Which file was changed
- What was added/modified/removed
- Why (one sentence)

This keeps the codebase navigable across sessions without re-reading all code.
