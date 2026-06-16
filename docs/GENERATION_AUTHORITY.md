# Lesson Generation Authority

Lesson generation uses one owner for each important decision. Later stages may consume
an earlier decision, but they may not silently replace it.

## Authority Order

| Decision | Owner | Enforced by |
| --- | --- | --- |
| What may be taught | Course boundary | Source coverage validation and scope preflight |
| Topic page count and sequence | Topic plan | Versioned `TopicLessonPlan` |
| Page focus, content kind, length, and role | Topic plan | `GenerationAuthorityContract.sequence` |
| Target understanding and success criteria | Page brief | `GenerationAuthorityContract.objective` |
| Wording, examples, representation, sections, and tone | Lesson writer | Writer prompt |
| Whether the result is acceptable | Quality evaluator | Lesson quality score, repair, or rejection |

## Structured Contract

Every generated page receives and persists a `generation-authority-v1` contract.
It records:

- Scope admission and the course mode.
- Locked page number, page count, focus, content kind, page mode, target length, and role.
- Locked target understanding and success criteria.
- The limited decisions delegated to the writer.
- The quality threshold used for acceptance.

The generated response is normalized against this contract before grounding or quality
evaluation. A model response cannot change page number, focus, shape, existence, length,
or target understanding.

## Deterministic Page Shapes

- `bridge` becomes `micro`.
- `section` and `example` become `short`.
- `full_page` with `short` or `medium` target length becomes `full`.
- `full_page` with `long` target length becomes `critical`.
- `skip` becomes non-generatable.

Normal topic plans do not contain skip placeholders. If a page does not earn its
existence, the planner omits it before any writer call.

## Source Boundary

Source-grounded generation accepts only canonical topics with
`source_coverage: "covered"`. Missing or inferred coverage is rejected before source
indexing, retrieval, research, architecture analysis, or lesson writing.

## Custom Requests

Custom instructions and adaptive approaches may produce a fresh page brief for an
existing planned page. They may change the teaching objective or explanation strategy,
but they cannot extend the topic past its planned page count or change the page shape.

## Cached Plans

Topic plan version 3 introduces this authority contract. Older plans are stale and are
regenerated on the next topic visit so embedded briefs mirror the plan's locked shape
and sequence role.
