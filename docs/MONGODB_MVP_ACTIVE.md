# MongoDB MVP Active Architecture

MongoDB Atlas + NextAuth are the active MVP persistence and authentication stack.

## Active Rules

- `lib/db.ts` is the database entrypoint.
- NextAuth with the MongoDB adapter is the auth path.
- Every generated course belongs to a signed-in user id.
- Every course-owned query must be scoped by `course_id`, `user_id`, or both.
- Supabase files are archive-only and must not guide MVP implementation.

## Active MVP Collections

- `courses`
- `branches`
- `topics`
- `topicEdges`
- `courseSummaries`
- `topicSummaries`
- `pages`
- `pageSummaries`
- `doubtMessages`
- `quizQuestions`
- `quizAttempts`

## Deferred

- Source parsing and source-grounded generation.
- Atlas Vector Search.
- Embeddings.
- Long-term doubt memory beyond the current stored page and recent chat window.
