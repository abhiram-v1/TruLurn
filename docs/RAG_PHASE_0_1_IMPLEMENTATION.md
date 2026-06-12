# RAG Phase 0 and Phase 1 Implementation

Implemented: 2026-06-13

## Phase 0: Correctness and Trust

- Retrieval now fails closed. Vector errors and empty results return no evidence;
  recent unrelated records are never substituted.
- ANN prefilters include tenant, course, active embedding version, current-topic
  exclusion, and learner-message role where applicable.
- Only learner-authored doubt messages are semantically retrievable. Assistant
  responses remain available as short-lived conversation history but are excluded
  from the evidence index.
- Embeddings persist provider, model, dimensions, immutable version, status, error,
  and update time.
- Vector indexes use version-two names and filter-compatible definitions.
- Source-grounded page generation requires every source chunk and its vector index to
  be ready. Existing courses receive an automatic bounded source backfill attempt.
- Retrieval traces record selected IDs, scores, timing, model version, and failures.
  Raw query previews are disabled unless `RAG_TRACE_QUERY_PREVIEW=1`.
- Uploaded and retrieved content is delimited as untrusted evidence in doubt and
  lesson prompts.

## Phase 1: Durable Source Ingestion

Each upload now creates:

- `sourceDocuments`: stable source identity and course ownership.
- `sourceDocumentVersions`: immutable original/version metadata and extraction state.
- `sourceIngestionJobs`: retryable parse, chunk, and embed jobs with attempt budgets.
- `sourceBlocks`: ordered canonical headings, prose, lists, tables, and code.
- `sourcePassages`: structured retrieval passages with provenance and versioned
  embeddings.
- `sourceObjects.files` / `sourceObjects.chunks`: original files in MongoDB GridFS.

Course generation stores the upload first and returns a generation job. The SSE
generation worker resumes the durable ingestion jobs from GridFS, assembles the
legacy `sourceText` required by the current curriculum prompts, and then continues.

When the course is persisted, structured passages are attached to the course and
dual-written into `sourceChunks`, preserving compatibility with the current retrieval
layer while avoiding duplicate embeddings.

## Operational Behavior

- New vector indexes are created automatically during course creation.
- Existing source-grounded courses are migrated lazily when a page is generated.
- `/api/vector/setup` remains available for an explicit user-scoped backfill.
- `/api/vector/status` reports the active embedding version and version-compatible
  readiness.
- Source files default to a 25 MB per-file limit. Override with
  `MAX_SOURCE_FILE_BYTES`.
- Retrieval traces expire after 30 days.

## Remaining Roadmap

Phase 2 should add hybrid lexical+dense retrieval, fusion, reranking, calibrated
thresholds, evidence diversity, and a formal offline evaluation harness. The Phase 1
schema is designed so Phase 2 can query `sourcePassages` directly and retire the
legacy `sourceChunks` dual-write after migration.
