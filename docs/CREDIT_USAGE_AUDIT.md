# TruLurn Credit Usage Audit

Audit date: June 14, 2026

## Scope and method

This audit traced every direct model, web-search, embedding, vision, retry, fallback,
and background execution path in the project. It also queried aggregate production
artifacts in MongoDB without printing lesson, chat, or source content.

Historical token totals were not persisted before this audit. Therefore:

- Execution counts and failure stages below are measured.
- Past dollar costs are modeled ranges based on the configured default models,
  persisted artifact sizes, and current provider prices.
- Exact per-feature token and cache accounting is now implemented for future runs.

Configured defaults when no environment override is present:

- Primary generation: OpenAI `gpt-5.4`
- Agent and lightweight generation: OpenAI `gpt-5.4-mini`
- Recall interruption classifier: Gemini `gemini-2.5-flash`
- Embeddings: OpenAI `text-embedding-3-small`
- Lesson and curriculum research: OpenAI web search

Current OpenAI standard prices used for estimates:

- GPT-5.4: $2.50/M input, $0.25/M cached input, $15/M output
- GPT-5.4 mini: $0.75/M input, $0.075/M cached input, $4.50/M output
- Web search: $10/1,000 calls, or $0.01 per call

## Measured activity

Production database snapshot:

| Activity | Last 7 days | All retained data |
|---|---:|---:|
| Course generation jobs | 7 | 8 |
| Completed jobs | 3 | 4 |
| Failed jobs | 3 | 3 |
| Running jobs | 1 | 1 |
| Courses created | 2 | 4 |
| Lesson pages created | 8 | 30 |
| Topic plans created or updated | 5 | 5 |
| Lesson retrieval workflows | 7 | 7 |
| Chat messages | 4, representing 2 exchanges | 16 |
| Exam questions generated | 6 | 44 |
| Exam answers evaluated | 4 | 33 evaluated turns |
| Recall pages generated | 1 | 1 |
| Source chunks embedded | 6 | 6 |

All three recent failed course jobs stopped during `building_atlas`.

- Two failed after an OpenAI map-generation timeout at 120 seconds.
- One failed on a network fetch error.
- Every failed job had already completed curriculum research and curriculum
  generation.
- The old Retry behavior created a new job and repurchased those completed stages.

Lesson quality data also shows meaningful intentional spend:

- Two stored pages required a second full writer pass before acceptance.
- Three recorded generation attempts still failed after their repair pass and
  produced no page.
- The quality gate is retained because removing it would degrade output quality.

## Ranked credit consumers

### 1. Lesson page generation and repair

Normal AI-teacher page:

1. One retrieval query embedding
2. One topic-plan call when the topic has no current plan
3. One lesson web-search call
4. One GPT-5.4 page-writing call
5. A second GPT-5.4 writing call when the quality gate requests repair
6. One page embedding after persistence

Source-grounded pages additionally run one grounding-verification call per writer
pass. The recent measured pages were not source-grounded.

Estimated cost:

- Normal page after the topic plan exists: about $0.035-$0.09
- First page of a new topic: about $0.06-$0.18
- Quality repair: adds about $0.025-$0.08
- Failed initial plus repair attempt: about $0.05-$0.16 with no stored page

Root causes:

- Web research ran again on every regeneration.
- Concurrent requests could independently start identical model work.
- Quality repair intentionally performs a complete second writer pass.
- Prompt-cache routing used a hash of the entire dynamic system prompt, reducing
  cache affinity for requests with the same stable instruction prefix.

### 2. Course generation

AI-teacher course generation normally invokes:

1. Topic validation
2. Curriculum web research
3. Curriculum generation
4. Atlas map generation
5. Learner-audience derivation

Source-grounded generation replaces web research with parallel source ordering and
source profiling, then uses the same curriculum, map, and audience stages.

Estimated successful course cost: about $0.20-$0.80, mainly determined by curriculum
and map output size.

Confirmed waste:

- Three failed Atlas jobs retained nine successful paid precursor calls in total:
  validation, research, and curriculum generation for each job.
- Retrying from the setup UI discarded those outputs.
- The SSE worker had no ownership lease. Reconnects or multiple tabs could execute
  the same job concurrently.
- When the SSE client disconnected, stage persistence was skipped even though paid
  background work continued. A reconnect could then repeat the unrecorded stage.

### 3. Exam engine

Measured recent minimum:

- 6 GPT-5.4 question-generation calls
- 4 GPT-5.4-mini evaluation calls
- Up to 2 strategy calls, one per recent session

Estimated cost per answered turn: about $0.012-$0.05.

Risk:

- `withRetry` allows three attempts.
- Each attempt can itself traverse the primary and fallback providers.
- A persistent provider failure can therefore expand to as many as six provider
  attempts for one question or evaluation.

This chain was not changed because it is a reliability mechanism and no retry
frequency was historically recorded. New telemetry will show whether it is actually
burning credits before its policy is tightened.

### 4. Agent chat

A normal question uses:

1. Zero or one intent-classification call
2. Zero or one teaching-adjustment call for messages matching explicit setting hints
3. One answer-generation call
4. One grounding-verification call only for source-grounded answers
5. One user-question embedding

The combined intent classifier already replaced two older sequential classifiers,
and deterministic routes avoid classification for obvious messages.

Estimated cost per normal exchange: about $0.005-$0.04. A retrieval-sentinel retry
can add a second answer call, but historical sentinel frequency was not recorded.

### 5. Recall and interruption timing

- Recall page: one GPT-5.4 call per opened study stretch, with open sessions reused.
- Interruption timing: Gemini is called only for ambiguous timing after deterministic
  safety rails, at least 30 seconds apart.

Estimated recall-page cost: about $0.01-$0.05.
Interruption calls are normally below $0.001 each.

### 6. Embeddings and source vision

Embeddings are frequent but low-cost. The retrieval layer already shares one query
embedding across page, doubt, and source searches in the same workflow.

The MarkItDown service can make up to 20 vision-caption calls per source document.
It previously deduplicated images only within one PDF conversion, so retries or
reuploads could caption identical images again.

### Dormant compatibility paths

The repository still contains older callable AI surfaces:

- `/api/ai/flow` and its Gemini compatibility alias
- `/api/ai/source-page` and its Gemini compatibility alias
- The standalone `generateCourse` helper
- The older one-shot `generateQuizQuestions` helper

No current frontend references were found for these paths, so they are not measured
current burners. They remain externally callable and could consume credits if an old
client or integration still invokes them. They were not removed because compatibility
and feature preservation were explicit requirements.

## Implemented optimizations

### Resumable failed course jobs

Retry now reactivates the same failed job and continues from `completed_stages`.
Research, curriculum, source analysis, and other completed outputs remain unchanged.

Expected saving after an Atlas failure: approximately 45-75% of the retry cost.
For the three measured failures, this would avoid repurchasing nine successful
precursor model/search calls.

### Single-owner course-generation worker

Generation jobs now use an atomic MongoDB worker lease.

- One connection owns the paid pipeline.
- Duplicate connections observe durable progress instead of starting another worker.
- The lease renews while long model calls are running.
- Stage writes continue after an SSE client disconnects.
- Worker ownership is verified before each stage update.

Expected saving: 50% for every accidental duplicate two-worker execution, and more
when multiple reconnects previously overlapped.

### Exact-request single-flight

Identical concurrent model and web-search requests in the same server process now
share one promise and one provider call. The request hash includes the complete
system prompt, user prompt, schema, response mode, reasoning effort, feature, and
search context size.

The returned model output is byte-for-byte the same shared result, so this does not
change generation style or quality.

### Lesson research cache

Successful lesson research is cached for 30 days by course, topic, page, focus, and
prompt version.

Regenerating the same page reuses the exact factual anchor and source list.

Saving per cache hit:

- One $0.01 web-search tool call
- The accompanying GPT-5.4-mini input and output tokens
- Roughly 10-30% of a typical regenerated page's total provider cost

### Prompt-cache routing

OpenAI requests now use a stable cache-routing key per feature, provider, and model
instead of hashing the entire dynamic system prompt.

Prompt text and message roles are unchanged. This only improves the chance that
stable prompt prefixes land on the same cache shard.

At current prices, each million GPT-5.4 input tokens served from cache saves $2.25;
each million GPT-5.4-mini input tokens served from cache saves $0.675.

### Embedding reuse

Exact embedding inputs now use:

- In-flight deduplication
- A 15-minute cache for query embeddings
- A 60-minute cache for document embeddings
- A bounded 256-entry LRU

The cache key includes embedding version, provider, model, dimensions, task type,
and exact text, so vector behavior is unchanged.

### Vision caption reuse

The MarkItDown service now caches up to 512 exact image captions, including
decorative-image decisions, per process. The key includes image bytes, provider,
model, and caption prompt.

### Valid fallback model

The graph fallback referenced retired `gemini-2.0-flash-lite`. It now uses
`gemini-2.5-flash-lite`, preventing a fallback failure that could trigger further
retries without useful output.

### Durable usage telemetry

New `aiUsageEvents` records retain 90 days of privacy-safe accounting:

- Feature
- Provider and model
- Generation, search, or embedding operation
- Success, failure, or avoided call
- Duration
- Prompt character counts and estimated tokens
- Provider-reported input, cached-input, output, and total tokens
- Failure category
- Avoided-call reason

No prompt, response, lesson, chat, or source text is stored.

Run `node scripts/audit-credit-usage.mjs` for aggregate counts and future exact token
totals by feature.

## Before and after

| Scenario | Before | After |
|---|---|---|
| Retry failed Atlas job | Re-run all earlier paid stages | Re-run only unfinished stage onward |
| Two SSE connections | Up to two complete paid workers | One worker, one observer |
| SSE disconnect mid-stage | Paid work could continue without stage persistence | Stage state remains durable |
| Two identical concurrent AI calls | Two provider calls | One shared provider call |
| Regenerate same lesson page | New web search every time | Reuse exact research for 30 days |
| Repeated exact embedding | New embedding call | Reuse exact vector within bounded TTL |
| Reprocess identical image | New vision call | Reuse exact caption decision |
| OpenAI prompt caching | Dynamic full-system cache key | Stable feature-level cache routing |
| Cost diagnosis | Route logs only; historical tokens unavailable | 90-day per-feature token telemetry |

Conservative expected savings:

- Normal first-time generation with no retries: 5-20%, mainly prompt caching.
- Lesson regeneration: 10-35%, mainly cached research and embedding reuse.
- Failed course retry after curriculum completion: 45-75%.
- Duplicate concurrent request: up to 50% per duplicate pair.
- Repeated source conversion with the same images: up to 100% of repeated caption calls.

These percentages do not assume removal of any quality pass, grounding verifier,
persona instruction, memory context, research feature, quiz capability, or fallback.

## Quality and behavior verification

- No lesson, course, quiz, recall, grounding, persona, or agent prompt was shortened.
- No model was downgraded on a normal successful path.
- No quality gate, grounding verifier, web-research feature, retry feature, or
  fallback feature was removed.
- Cached lesson research returns the exact prior research result.
- Single-flight callers receive the exact same generated result.
- Failed course retry reuses the exact stored curriculum and research outputs.
- TypeScript typecheck passes.
- All 60 automated tests pass.
- Production Next.js build completes successfully.
- MarkItDown Python module compiles successfully.

The build still prints MongoDB DNS timeout messages in the restricted local build
environment after completing successfully. Live database connectivity was separately
verified, with a 1.364-second ping.

## Residual risks

- Quality repair remains expensive by design. Future telemetry should be used to
  reduce first-pass rejection through evaluation and prompt tuning, not by weakening
  the quality threshold.
- Exam retry multiplication remains in place until measured retry data proves which
  errors can safely stop after provider fallback.
- In-process single-flight does not deduplicate identical requests that land on
  different server instances. Course generation is protected cross-instance by its
  MongoDB lease; lesson-page generation is still protected only by existing-page
  checks plus in-process single-flight.
- Timed-out provider requests may still be billed upstream even when no response
  reaches TruLurn. The new telemetry records these as failed attempts with unknown
  provider tokens so they remain visible.

## Pricing sources

- OpenAI API pricing: https://openai.com/api/pricing/
- Gemini API pricing: https://ai.google.dev/gemini-api/docs/pricing
