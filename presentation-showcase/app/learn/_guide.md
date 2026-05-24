# app/learn/ — Learning Experience

> The core of the product. Three-panel layout: roadmap / lesson / doubt chat.

---

## Route Structure

```
learn/
├── layout.tsx                    ← Three-panel shell (always rendered)
└── [courseId]/
    ├── page.tsx                  ← Redirects to first active/unlocked topic
    └── [topicId]/
        └── page.tsx              ← Main lesson view for a specific topic
```

---

## layout.tsx
**Purpose:** The three-panel shell. Renders on every learn route.  
**What it renders:**
- `<MiniRoadmap />` — left panel (190px), receives course topics + current topicId
- `<Outlet />` / `{children}` — middle panel (flex: 1), the active page
- `<DoubtChat />` — right panel (240px), receives current topicId + pageNumber

**Data fetched here:**
- Full course + topics (for roadmap state)
- Current user session

**Important:** This layout does NOT fetch lesson pages. Pages are fetched in the per-topic page.

---

## [courseId]/page.tsx
**Purpose:** Smart redirect. Finds the first `active` or `partial` topic and redirects to it.  
**Logic:**
```
topics.find(t => t.state === 'active' || t.state === 'partial')
→ redirect to /learn/[courseId]/[topicId]
```
Shows a loading state while redirecting.

---

## [courseId]/[topicId]/page.tsx
**Purpose:** Renders the lesson for a specific topic. This is the main learning view.  
**Data fetched:**
- Topic metadata (title, state, understanding_level)
- All pages for this topic (from `pages` table)
- Current page number (from URL search param `?page=1`, defaults to 1)

**What it renders:**
- `<LessonPage />` — the content for the current page
- `<PageNav />` — prev/next navigation
- `<PageControls />` — Simplify / Go Deeper / Add Example buttons

**URL pattern:** `/learn/[courseId]/[topicId]?page=2`  
Page number lives in the URL so it's shareable/refreshable.

**Quiz button:** A persistent "Take Quiz" button appears at the bottom of the last page, or in the top bar always. Links to `/quiz/[topicId]`.

---

## State Rules

- Middle panel: NO text input. Controls only (buttons).
- Page content is stored markdown — rendered via a markdown renderer (e.g., `react-markdown`).
- If the topic is `locked`, redirect to the roadmap with a message: "Complete [prerequisite] first."
- If the topic is `unstable`, show a banner at the top: "This topic needs review. Start here before moving forward."
