# components/ui/ — Shared Primitive Components

> Small, reusable components with no business logic. Purely presentational.

---

## TopicPill.tsx
**Role:** Colored badge showing a topic's mastery state.  
**Props:**
```typescript
{
  state: TopicState   // 'locked' | 'active' | 'partial' | 'functional' | 'mastered' | 'unstable'
  label: string       // topic title
  size?: 'sm' | 'md'
}
```
**Colors:**

| State | Background | Text | Dot color |
|---|---|---|---|
| `mastered` | `#EAF3DE` | `#3B6D11` | `#639922` |
| `functional` | `#E6F1FB` | `#185FA5` | `#185FA5` |
| `partial` | `#FAEEDA` | `#854F0B` | `#BA7517` |
| `unstable` | `#FDE8E8` | `#B91C1C` | `#dc2626` |
| `active` | accent bg tint | accent text | `#d36d4a` |
| `locked` | transparent | `#d3d5d7` | `#d3d5d7` |

---

## PagePaginator.tsx
**Role:** "Page X of Y" indicator.  
**Props:**
```typescript
{
  current: number
  total: number
}
```
**Renders:** `Page 2 of 6` — small, gray, centered.  
Font size: `--text-sm` (13px). Color: `--color-text-secondary`.

---

## ContextBadge.tsx
**Role:** Shows the current learning context at the top of the doubt chat.  
**Props:**
```typescript
{
  topicTitle: string
  pageNumber: number
}
```
**Renders:** `Context: Linear Regression · Page 2`  
Styled as a small pill/tag. Non-interactive. Always visible at top of doubt chat.  
**Purpose:** Constant visual reminder to the user (and enforcement of) the chat's scope.  
Font: `--text-xs` (11px), uppercase, letter-spacing. Color: `--color-text-secondary`.
