# Gemini Skills Layer

TruLurn treats skills as local product capabilities, not provider features. Gemini generates text, but the app owns the rules, JSON contracts, source limits, and product boundaries.

## Current Skills

| Skill | File | Purpose |
| --- | --- | --- |
| `curriculum_builder` | `lib/ai/skills/curriculumBuilder.ts` | Builds the first course draft from either AI teacher mode or source-grounded mode. |
| `flow_tracker` | `lib/ai/skills/flowTracker.ts` | Recommends conservative progress changes from demonstrated evidence only. |
| `scoped_chat` | `lib/ai/skills/scopedChat.ts` | Answers doubts inside the current page/topic boundary. |
| `source_learning_page` | `lib/ai/skills/sourceLearningPage.ts` | Writes one lesson page from supplied source text only. |

## API Routes

| Route | Input | Output |
| --- | --- | --- |
| `POST /api/gemini/curriculum` | JSON or form data with `topic`, `goals`, `mode`, and optional `sources` files | `{ curriculum, map, sourceLimitations }` |
| `POST /api/gemini/source-page` | JSON with `topicTitle`, `pageNumber`, `sourceText` | `{ page }` |
| `POST /api/gemini/chat` | JSON with `topicTitle`, `pageNumber`, `pageContent`, `userQuestion` | `{ answer }` |
| `POST /api/gemini/flow` | JSON evidence object | `{ flow }` |

## MVP Source Rules

Source-grounded mode currently reads text-like uploads only: `.txt`, `.md`, `.markdown`, `.json`, and `.csv`.

PDFs should not be accepted silently. Add a real PDF extraction step before using PDFs for source-grounded learning.

## Safety Rules

- Do not infer what the learner understands internally.
- Use evidence language: "your answer demonstrated..." or "this response did not show...".
- Keep chat scoped to the current page and topic.
- Keep structural maps separate from user progress.
- Treat all Gemini JSON as a draft until it passes validation and user review.
