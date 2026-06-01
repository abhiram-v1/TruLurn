# Course System Rebuild Plan

This plan replaces the current setup-page preview flow with a database-driven course workspace.

## Current Diagnosis

The implementation no longer matches the intended architecture.

- `components/setup/TopicInput.tsx` renders a generated roadmap preview inside setup. This must be removed.
- `app/api/gemini/curriculum/route.ts` generates, persists, and returns preview data in one request. It uses `local-user`, not authenticated ownership.
- `app/api/generate/course/route.ts` duplicates course persistence logic.
- `app/learn/[courseId]/[topicId]/page.tsx` generates lesson pages inside a page load. This makes navigation slow, non-deterministic, and fragile.
- `generateSecondaryRoadmap()` hardcodes exactly 3 pages. This violates adaptive roadmap depth.
- The docs and `.env.local` point toward Supabase, while the active implementation uses MongoDB and NextAuth. The project needs one database/auth direction before production architecture can stabilize.

## Target Behavior

Course setup is only an input and job-starting flow:

1. User chooses curriculum mode and sources.
2. Server creates a course generation job.
3. AI generates the primary roadmap.
4. Server stores course, roadmap, relationships, source mappings, and initial progress.
5. App redirects to `/course/[courseId]`.
6. `/course/[courseId]` becomes the central roadmap workspace.
7. Clicking a topic routes to `/learn/[courseId]/[topicId]`, which loads database-backed content and AI context.

The roadmap must never be embedded in setup after generation.

## Architecture Decision

Use MongoDB Atlas + NextAuth as the canonical MVP database and auth stack.

Reasons:

- The active code already uses MongoDB and the NextAuth MongoDB adapter.
- `MEMORY.md` defines the current memory architecture around MongoDB Atlas.
- MongoDB Atlas Vector Search can support the later retrieval layer without introducing another database.
- Course isolation is enforced in application queries with `user_id` and verified course ownership.

Supabase files in this repository are archive-only artifacts and are not part of the MVP execution path.

## Data Model

### Core Tables

- `courses`: root course metadata, owner, mode, status, style anchor.
- `course_generation_jobs`: async generation status, progress, errors, timestamps.
- `sources`: uploaded source metadata, storage path, checksum, processing state.
- `source_chunks`: parsed source chunks with page/section metadata.
- `branches`: top-level roadmap modules.
- `topics`: roadmap nodes, branch link, parent link, state, depth, ordering.
- `topic_edges`: prerequisite/concept dependency edges.
- `topic_source_links`: maps topics to source chunks used to create them.
- `pages`: stored lesson pages, page focus, markdown content, version.
- `page_summaries`: concise summaries and key concepts per page.
- `memory_chunks`: semantic memory records for retrieval.
- `embeddings`: vector rows for source chunks, pages, summaries, chats, quiz evidence.
- `doubt_messages`: scoped chat history per topic/page.
- `quiz_questions`: stored quiz pool.
- `quiz_attempts`: user answers and AI evaluations.
- `progress_events`: append-only evidence log for roadmap state changes.

### Ownership Rules

- Every course belongs to a NextAuth user id.
- Every child row is reachable from a course.
- MongoDB has no RLS. Every server route must verify the signed-in user owns the course before reading or writing course data.
- Never query course-owned collections without a `course_id` or `user_id` boundary.

## Adaptive Roadmap Generation

Remove fixed topic counts and fixed 3-page assumptions.

The roadmap prompt should ask the model to choose structure from:

- subject difficulty
- learner goals
- target depth
- prior knowledge
- source volume
- prerequisite density
- likely misconception risk

The response must include:

- branches/modules
- topics/subtopics
- depth: `light | medium | important | critical`
- estimated page count per topic
- prerequisites by stable temporary ids
- edge reasons
- source coverage notes when source-grounded

Validation should enforce quality without hardcoding counts:

- minimum viable breadth unless the subject is genuinely narrow
- no orphaned prerequisites
- no duplicate topics
- no circular dependencies
- no branch with zero topics
- page counts align with depth
- first active path is reachable

## Generation Pipeline

### Phase 1: Create Job

Route: `POST /api/courses/generate`

Inputs:

- topic
- goals
- mode
- source files or source ids

Outputs:

- `jobId`
- `courseId`
- redirect target: `/course/[courseId]?generating=1`

The route immediately creates:

- course row with `status = generating`
- job row with `status = queued`
- source rows if any

### Phase 2: Process Sources

For source-grounded mode:

1. Store original source files.
2. Extract text.
3. Chunk by semantic sections, not arbitrary character windows.
4. Generate chunk summaries.
5. Generate embeddings.
6. Store source chunks and embeddings.

PDF support must wait until real PDF parsing exists.

### Phase 3: Build Roadmap

1. Retrieve source summaries if source-grounded.
2. Generate adaptive roadmap JSON.
3. Validate JSON.
4. Normalize temporary ids into database ids.
5. Insert branches, topics, and topic_edges in one transaction.
6. Set first reachable topic to `active`; others locked unless prerequisites allow active.

### Phase 4: Build Initial Content

Generate only the minimum content needed for a fast first experience:

- first active topic page 1
- page summary
- embedding for the page
- initial quiz pool may run in background

Later pages generate through a controlled server route, not inside the page component.

### Phase 5: Complete Job

When the first usable learning path exists:

- set `courses.status = ready`
- set job `status = complete`
- redirect or refresh the roadmap workspace

## Routing Model

### Setup

`/setup`

- collects inputs
- starts generation job
- never renders roadmap
- redirects to `/course/[courseId]?generating=1`

### Roadmap Workspace

`/course/[courseId]`

- fetches course, branches, topics, edges, progress from DB
- if generating, shows job progress
- if ready, renders big roadmap
- clicking a branch opens the first active topic in that branch

### Learning Interface

`/learn/[courseId]/[topicId]`

Must deterministically load:

- course
- topic
- branch topics
- pages
- page summaries
- linked source chunks
- relevant memory chunks
- doubt history
- progress state

If no page exists, call `POST /api/topics/[topicId]/pages/generate` from a controlled loading/action flow. Do not generate directly in the React server component.

## Retrieval Architecture

Retrieval is a course memory service, not a UI feature.

### Memory Records

Every memory row should include:

- course id
- topic id when applicable
- source type: `source_chunk | page | summary | chat | quiz_evidence`
- content
- summary
- embedding
- checksum
- version
- created_at

### Retrieval Flow For Topic Open

1. Fetch topic and branch context.
2. Fetch current page or create a page generation job.
3. Fetch page summary and key concepts.
4. Retrieve top semantic memories scoped to the same course.
5. Prefer topic-linked/source-linked memories before broad course memories.
6. De-duplicate by checksum and source id.
7. Build AI context with strict priority:
   - current page
   - topic roadmap
   - linked sources
   - stored summaries
   - relevant memories
   - recent scoped chat

### Duplicate Pollution Control

- Hash every chunk/page/chat summary.
- Do not embed identical content twice.
- Re-embed only when version changes.
- Store chat memory only after summarization, not every raw message.

## Topic To Content Contract

Clicking a roadmap topic must never lead to an empty interface.

Before navigation is allowed:

- topic exists
- topic belongs to the course
- user owns the course
- topic is unlocked or active

When opened:

- if pages exist, render them
- if no pages exist but generation is allowed, create page generation job and show a deterministic loading state
- if generation fails, show a recoverable error with retry
- never silently render an empty lesson

## API Boundary

Replace provider-specific routes with product-level routes:

- `POST /api/courses/generate`
- `GET /api/courses/[courseId]`
- `GET /api/courses/[courseId]/roadmap`
- `GET /api/topics/[topicId]/learn`
- `POST /api/topics/[topicId]/pages/generate`
- `POST /api/topics/[topicId]/chat`
- `POST /api/topics/[topicId]/quiz/evaluate`
- `POST /api/topics/[topicId]/progress/update`

Gemini should live behind `lib/ai/providers/gemini`, not in route names.

## Execution Phases

### Phase 0: Stop The Broken Flow

- Remove `BigRoadmap` from setup.
- Setup submits and redirects only.
- Delete or disable preview JSON/roadmap state in setup.
- Keep old mock course only as seed/demo data, not generation output.

### Phase 1: MongoDB Foundation

- Mark Supabase artifacts archive-only.
- Keep `lib/db.ts` and the NextAuth MongoDB adapter as the active stack.
- Replace direct unscoped Mongo queries with repository-style helpers where useful.
- Implement authenticated user lookup for server routes.
- Remove `local-user`.

### Phase 2: Course Persistence

- Implement `createCourseGenerationJob()`.
- Store course, sources, branches, topics, and edges transactionally.
- Add status/progress fields.
- Redirect setup to `/course/[courseId]`.

### Phase 3: Adaptive Roadmap Generator

- Replace fixed-count Gemini skills.
- Add roadmap schema validation.
- Add id normalization and prerequisite resolution.
- Add retry/repair pass for invalid JSON.

### Phase 4: Topic Content Pipeline

- Generate page focus plans from topic depth.
- Generate page 1 for first active topic.
- Store pages, summaries, key concepts, and embeddings.
- Move on-demand page generation out of page components into API/job routes.

### Phase 5: Retrieval And Memory

- Implement chunking and embeddings.
- Implement retrieval query service.
- Add topic open context builder.
- Add scoped chat context builder.
- Add memory dedupe/checksum logic.

### Phase 6: Roadmap And Learning Routes

- Make `/course/[courseId]` database-driven.
- Make `/learn/[courseId]/[topicId]` fail-safe and database-driven.
- Enforce locked topic behavior server-side.
- Ensure reload resumes exactly from stored state.

### Phase 7: Quiz And Progress

- Store quiz pools.
- Evaluate answers through AI service.
- Write progress events.
- Update topic/branch state from deterministic roadmap logic.

### Phase 8: Cleanup

- Remove duplicated generation routes.
- Keep MongoDB as the MVP persistence layer.
- Replace provider-named routes with product routes.
- Add route tests for setup, roadmap, topic open, chat, and progress.

## Non-Negotiable Rules

- Setup never renders the roadmap.
- Roadmap is always database-backed.
- Lesson pages are stored before render.
- Topic click never renders an empty shell.
- AI provider code is isolated behind the AI service layer.
- Progress updates are evidence-based, not chat-vibe-based.
- Source-grounded mode cannot claim grounding unless source parsing, chunking, retrieval, and citations exist.
