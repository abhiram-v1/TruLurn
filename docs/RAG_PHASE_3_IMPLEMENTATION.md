# RAG Phase 3: Source Fidelity and Citations

Implemented on June 13, 2026.

## Evidence Contract

Retrieved source passages are converted into stable evidence packets before
generation. Each packet carries:

- A prompt-local citation ID such as `S1`.
- Passage, source-document, and immutable source-version IDs.
- Source title, uploaded order, passage ordinal, heading path, block ordinals, and
  character coordinates when available.
- Retrieval score/method metadata and the bounded evidence content.

Newly ingested passages persist character coordinates, and the legacy `sourceChunks`
dual-write preserves the same provenance fields.

## Citation-Aware Generation

- Source-grounded lesson prompts label every passage with its citation ID.
- Source-grounded lesson and doubt prompts require inline citations immediately after
  supported factual claims.
- Inferences and teaching analogies must be labeled and anchored to evidence.
- Conflicting sources must remain visibly distinct and cite every conflicting
  passage.
- Lesson pages persist the citations they used and show a compact source legend.
- Assistant doubt messages persist their citations and grounding report; their
  Markdown response includes a source legend.

## Verification and Repair

`lib/grounding/sourceGrounding.ts` runs `claim-evidence-v1` before source-grounded
content is persisted.

The verifier:

1. Audits claims against the supplied evidence packets.
2. Rejects unknown or missing citation IDs.
3. Repairs or removes unsupported claims without adding outside knowledge.
4. Preserves explicit source conflicts and verifies that all conflict citations are
   visible in the final output.
5. Abstains when the evidence cannot support a useful result.

Lesson generation fails closed with HTTP 422 when verification cannot produce a
usable cited page. Source-grounded doubt answering returns an explicit abstention
when retrieval yields no safe evidence.

## Persisted Audit Data

Pages, page summaries, and assistant doubt messages now store:

- `source_citations`
- `grounding.version`
- `grounding.status`
- `grounding.citation_ids`
- `grounding.evidence_ids`
- Claim-level support decisions
- Detected source conflicts
- Verification summary and timestamp

The verifier has its own AI routing feature:
`source_grounding_verification`. It can be configured with the standard
`AI_FEATURE_SOURCE_GROUNDING_VERIFICATION_*` overrides.
