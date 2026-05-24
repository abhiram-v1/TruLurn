# components/learn/ — Learning View Components

> These five components compose the entire three-panel learning experience.

---

## ThreePanelLayout.tsx
**Role:** Pure layout shell. Three columns. No data logic.  
**Props:** `children` for middle panel, passes through left and right panel slots  
**Layout:**
```css
display: grid;
grid-template-columns: 190px 1fr 240px;
height: 100vh;
```
**Notes:** Thin 0.5px borders between panels. No shadows. Overflow hidden on each panel.

---

## MiniRoadmap.tsx
**Role:** Left panel. Shows the topic tree for the current course.  
**Props:**
```typescript
{
  topics: Topic[]        // full topic tree for the course
  currentTopicId: string // highlights the active topic
  courseId: string       // for building navigation links
}
```
**What it renders:**
- Nested topic list grouped by section
- Each topic as a `<TopicPill />` with state color
- Clicking unlocked topic → navigates to `/learn/[courseId]/[topicId]`
- Clicking locked topic → shows inline message: "Complete [prerequisite] first"
- No random jumping into locked topics — enforce this in the click handler

**State colors:** Unstable=red, Partial=amber, Functional=blue, Mastered=green, Active=accent, Locked=gray

---

## LessonPage.tsx
**Role:** Middle panel content. Renders one page of lesson markdown.  
**Props:**
```typescript
{
  content: string      // markdown string from pages table
  topicTitle: string
  pageNumber: number
  totalPages: number
}
```
**What it renders:**
- Rendered markdown (use `react-markdown` with `remarkGfm`)
- NO text input anywhere in this component or its children
- Clean typography — generous line height, max-width for readability (~680px)

**Notes:** Content is already stored — no AI calls happen here. Pure render.

---

## PageControls.tsx
**Role:** Three buttons that trigger page rewrites.  
**Props:**
```typescript
{
  topicId: string
  pageNumber: number
  onRewrite: (type: 'simplify' | 'deeper' | 'example') => void
}
```
**What it does:** Calls `POST /api/generate/rewrite` with the rewrite type.  
The parent component handles the response and replaces `content` in state.  
**UI:** Three small text buttons, not filled/prominent. Should feel like subtle reading controls.

---

## PageNav.tsx
**Role:** Prev / Next page navigation.  
**Props:**
```typescript
{
  currentPage: number
  totalPages: number
  courseId: string
  topicId: string
}
```
**What it renders:**
- "← Previous" button (disabled on page 1)
- "Page X of Y" indicator (via `<PagePaginator />`)
- "Next →" button (disabled on last page)
- On last page: replaces Next with "Take Quiz →" button linking to `/quiz/[topicId]`
**Navigation:** Updates URL `?page=N` and fetches new page content.

---

## DoubtChat.tsx
**Role:** Right panel. Scoped doubt chat.  
**Props:**
```typescript
{
  topicId: string
  topicTitle: string
  pageNumber: number
  pageContent: string   // current page content, sent to API for context
}
```
**What it renders:**
- `<ContextBadge />` at top showing "Context: [topicTitle] · Page [N]"
- Scrollable message history (stored per topic in `doubt_messages`)
- Text input at the bottom (the ONLY text input in the entire learn view)
- Streaming response as it arrives from `/api/chat/doubt`

**Client Component** (`'use client'`) — needs streaming state, scroll behavior.  
**History:** Loads from `doubt_messages` where `topic_id = topicId`, ordered by `created_at`.  
**On topic change:** Clears messages and loads new topic's history.
