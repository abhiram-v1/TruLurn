# Concept Learner Model

TruLurn keeps declared teaching preferences separate from demonstrated knowledge.
Choosing beginner, intermediate, or expert changes presentation. It does not prove what
the learner knows.

## Concept States

- `never_encountered`: no recorded exposure or assessment evidence.
- `recognizes`: the learner has seen or discussed the concept, but understanding is unproven.
- `understands`: repeated evaluated evidence shows they can explain the idea.
- `applies`: repeated evaluated evidence shows they can use the idea in a problem.
- `transfers`: evaluated success shows use in harder or changed contexts.
- `forgetting`: previously demonstrated knowledge has become stale and needs retrieval.

Each state stores confidence, freshness, evidence count, evidence-type counts, evidence
references, last evidence time, topic, and whether the state came from observation,
validated assessment, or an explicit learner correction.

## Evidence Hierarchy

| Evidence | What it can establish |
| --- | --- |
| Lesson page view | Encounter and recognition only |
| Learner question in chat | Discussion and recognition only |
| Lesson feedback | Low-weight self-report; never mastery by itself |
| Completed prompt-only recall | Retrieval exposure; never mastery by itself |
| Evaluated recall or explanation | Understanding after repeated success |
| Evaluated application or code | Application after repeated success |
| Hard application in changed context | Transfer after repeated success |
| Learner correction | Explicit override, visibly marked as learner-corrected |

A single weak signal cannot move a concept beyond recognition. Failed assessed evidence
reduces confidence. Recent unassessed exposure does not refresh old assessment evidence.

## Forgetting

Assessment freshness is evaluated separately from page activity. If demonstrated
understanding, application, or transfer has no assessed reinforcement for more than
45 days, the concept becomes `forgetting`. Lessons then use a brief retrieval cue before
building on it.

## Lesson Personalization

Each lesson receives only concept states related to its key concepts and prerequisite
requirements. Unrelated weaknesses, strengths, questions, and misconceptions are not
added to the prompt.

The teaching response depends on state:

- Recognition gets explanation rather than assumed mastery.
- Understanding can skip introductory recognition work but still needs application support.
- Application and transfer can be used as anchors.
- Forgetting gets a short retrieval cue.
- Missing evidence causes the lesson to introduce or verify the prerequisite.

## Learner Control

Settings > Learner memory shows concept state, evidence count, freshness, and source.
The learner can correct any stored concept state. Corrections are stored as explicit
overrides, invalidate the cached learner profile, and create an audit event.

## Storage

- `learnerConceptStates`: current concept-level state and evidence summary.
- `learnerSkillStates`: legacy numeric assessment estimate retained for compatibility.
- `learnerMemories`: preferences and profile facts.
- `learnerMisconceptionStates`: assessment-backed active or corrected misconceptions.
