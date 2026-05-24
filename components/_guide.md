# components/ — React Components

> All reusable UI components. Organized by feature area.

---

## Directory Map

```
components/
├── learn/     ← Components for the three-panel learning view
├── quiz/      ← Components for the quiz session
├── setup/     ← Components for the onboarding/setup page
└── ui/        ← Shared primitive components (pills, badges, etc.)
```

---

## Component Conventions

- All components are in PascalCase `.tsx` files
- Props are typed with explicit TypeScript interfaces at the top of the file
- No inline styles — Tailwind utility classes only
- No `styled-components`, no CSS modules
- Components should be small and focused. If a component exceeds ~150 lines, split it.
- Server Components by default. Add `'use client'` only if the component needs:
  - React state (`useState`, `useReducer`)
  - Effects (`useEffect`)
  - Browser APIs
  - Event handlers that update state

---

## Naming

| File | What it is |
|---|---|
| `ThreePanelLayout.tsx` | Shell only — no logic, just layout |
| `MiniRoadmap.tsx` | Renders topic tree with color states |
| `LessonPage.tsx` | Renders markdown lesson content |
| `PageControls.tsx` | Simplify / Go Deeper / Add Example buttons |
| `PageNav.tsx` | Prev / Next page navigation |
| `DoubtChat.tsx` | Scoped doubt chat (streaming) |
| `QuizSession.tsx` | Quiz state machine shell |
| `QuizQuestion.tsx` | Single question + textarea |
| `QuizResult.tsx` | Post-quiz feedback + roadmap update |
| `ModeSelector.tsx` | Mode A vs B choice |
| `TopicInput.tsx` | Topic + goals form |
| `HallucinationWarning.tsx` | Warning banner for Mode B |
| `TopicPill.tsx` | State-colored topic badge |
| `PagePaginator.tsx` | "Page X of Y" indicator |
| `ContextBadge.tsx` | "Context: Topic · Page N" in doubt chat |
