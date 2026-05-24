# components/setup/ — Setup / Onboarding Components

---

## ModeSelector.tsx
**Role:** Lets user choose between Mode A (source upload) and Mode B (AI as teacher).  
**Props:**
```typescript
{
  value: 'ai_teacher' | 'source_grounded'
  onChange: (mode: 'ai_teacher' | 'source_grounded') => void
}
```
**MVP behavior:** Mode A card is rendered but visually disabled with a "Coming soon" label.  
Only Mode B is selectable.  
**UI:** Two cards side by side, not a dropdown. Clear visual distinction between selected/unselected/disabled.

---

## TopicInput.tsx
**Role:** The main input form — topic and goals.  
**Props:**
```typescript
{
  onSubmit: (data: { topic: string; goals: string; mode: CourseMode }) => void
  isSubmitting: boolean
}
```
**Fields:**
- **Topic** — single line text input, placeholder: "e.g. Machine Learning, React, Constitutional Law"
- **Goals** — multi-line textarea, placeholder: "What do you want to be able to do at the end?"
- **Submit button** — "Build my curriculum" — disabled while `isSubmitting`

**Validation:**
- Topic: required, min 3 chars
- Goals: optional but nudged ("The more specific you are, the better your roadmap")

---

## HallucinationWarning.tsx
**Role:** Warning banner shown when Mode B is selected.  
**Props:** none  
**What it renders:**
```
⚠ This curriculum is AI-generated from model knowledge.
  Verify technical facts for professional or high-stakes applications.
```
**Styling:** Subtle amber/sand banner — not alarming, but impossible to miss.  
Use `--color-bg-secondary` (#f4e3b2) background with a thin amber-toned left border.
