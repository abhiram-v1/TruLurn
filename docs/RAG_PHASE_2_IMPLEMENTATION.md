# RAG Phase 2: Retrieval V2

Implemented on June 13, 2026.

## What Changed

- Added Atlas Search lexical indexes for pages, learner doubts, source chunks, and
  versioned source passages.
- Added a vector index for `sourcePassages`; new source-grounded courses retrieve
  passages while legacy courses continue to use `sourceChunks`.
- Retrieval now runs dense and lexical candidate generation in parallel.
- Candidate lists are fused with reciprocal-rank fusion and reranked using query
  coverage, exact technical terms, phrase matches, dense quality, and agreement
  between retrieval methods.
- Near-duplicate results are reduced with MMR-style diversity and per-topic/source
  caps.
- Low-confidence candidates are removed with workflow-specific thresholds.
- Lesson generation, doubt answering, topic planning, and generic retrieval have
  separate candidate widths, thresholds, diversity caps, and context budgets.
- Embedding failures degrade to lexical-only retrieval. Atlas Search failures
  degrade to dense-only retrieval. Unsafe recent-item fallback was not restored.
- Retrieval traces now include candidate counts, selected score components,
  latency, errors, and a dense-v1 versus hybrid-v1 shadow comparison.

## Operations

Create or inspect indexes through:

- `POST /api/vector/setup`
- `GET /api/vector/status`
- `node scripts/setup-vector-search.mjs`

Atlas index creation is asynchronous. The status endpoint reports whether each
vector and lexical index is queryable.

## Evaluation

Create `evaluation/rag/retrieval-judgments.jsonl` with one row per judged query:

```json
{"query_id":"q1","relevant_ids":["passage-1"],"ranked_ids":["passage-1","page-2"],"baseline_ranked_ids":["page-2"],"latency_ms":82}
```

Graded relevance is also supported:

```json
{"query_id":"q2","relevance":{"page-1":2,"passage-3":1},"ranked_ids":["page-1","passage-3"]}
```

Run:

```powershell
npm run eval:retrieval
```

The report includes Recall@5/10/20, context Precision@5/10/20, MRR, nDCG@10,
baseline deltas, and p50/p95 latency.

## Rollout Gate

Before tuning thresholds or enabling wider candidate sets:

1. Build a judgment set from real lesson and doubt queries.
2. Compare hybrid-v1 against the dense-v1 IDs stored in `retrievalTraces`.
3. Require no regression in source-grounded Recall@10 and no material p95 latency
   regression.
4. Review degraded traces to distinguish missing indexes from provider failures.
5. Tune policies per workflow rather than changing one global threshold.
