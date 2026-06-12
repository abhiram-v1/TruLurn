# RAG Phase 5: Cutover and Cleanup

Implemented on June 13, 2026.

## Release Controller

Retrieval policies are now independently configurable for:

- `lesson_generation`
- `doubt_answer`
- `topic_planning`
- `generic`

Each workflow supports four modes:

| Mode | Served result | Additional work |
|---|---|---|
| `legacy` | Dense V1 | No lexical shadow query |
| `shadow` | Dense V1 | Hybrid V2 is recorded for parity analysis |
| `canary` | Deterministic cohort split | Hybrid V2 is served only inside the configured percentage |
| `v2` | Hybrid V2 | Dense V1 remains in the retrieval trace for comparison |

Cohorts are stable for the same seed, user, course, and workflow. Rollback is a
policy update to `legacy` or `shadow`; it does not require a deployment.

Operations:

- `GET /api/vector/cutover`
- `PATCH /api/vector/cutover`

Example:

```json
{
  "workflows": {
    "lesson_generation": { "mode": "canary", "rolloutPercent": 10 },
    "doubt_answer": { "mode": "shadow" }
  }
}
```

The default remains `v2` to preserve the behavior already shipped by Phase 2.

## Historical Migration

Historical pages, learner-authored doubts, legacy source chunks, and structured
source passages are migrated in bounded, resumable batches. State is stored in
`ragMigrationJobs`; failed records are quarantined for the active embedding
version so one bad record cannot starve the queue.

Operations:

- `GET /api/vector/migration`
- `POST /api/vector/migration` with optional `batchSize`
- Set `retryFailed: true` to release quarantined failures for another attempt
- `POST /api/vector/setup` now runs a migration batch instead of the retired
  capped `backfillUserEmbeddings` helper

Moving a workflow to full `v2` through the API is rejected until migration is
complete.

## Parity and Traces

Every retrieval trace records:

- Cutover mode and deterministic cohort bucket
- The version actually served
- Dense V1 selected IDs
- Hybrid V2 selected IDs
- Candidate counts, degraded state, and duration

The status and cutover APIs aggregate overlap, degraded rate, sample count, and
average duration by workflow.

## Deletion Validation

Course deletion now cascades through the full source and learning lineage,
including source documents, versions, blocks, passages, ingestion jobs,
retrieval traces, memory, assessments, events, and GridFS originals.

A post-delete audit is written to `deletionValidationRuns`. Failed validation
causes the delete endpoint to return an error instead of reporting a false
success.

## Guarded Cleanup

Legacy vector cleanup is available through:

- `GET /api/vector/cleanup` to inspect gates
- `POST /api/vector/cleanup` with confirmation
  `RETIRE_LEGACY_VECTOR_FIELDS`

Cleanup is blocked unless:

1. Every retrieval workflow is in `v2`.
2. Historical migration is complete.
3. All dense and lexical indexes are queryable.
4. The configured parity sample and overlap thresholds pass.
5. The user has no orphaned source or retrieval lineage.

The cleanup removes known legacy vector fields and enforces that assistant
messages have no retrievable embedding. Shared indexes are not dropped by a
user-scoped cleanup.

## Verification

```powershell
npm run verify:cutover
npm run verify:grounding
npm run verify:memory
npm exec tsc -- --noEmit --incremental false
npm run build
```
