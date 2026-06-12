# RAG Phase 4: Learner Memory V2

Implemented on June 13, 2026.

## Store Boundaries

Memory V2 separates three kinds of learner state:

- `learnerMemories`: typed preference, goal, profile, and behavioral-observation
  records with authority, confidence, evidence references, validity intervals,
  decay, and immutable history.
- `learnerSkillStates`: assessment-derived Bayesian skill estimates. Raw chat,
  page views, and prompt-only recall breaks never update mastery.
- `learnerMisconceptionStates`: assessment-backed misconceptions that remain active
  until at least two later successful checks demonstrate correction.

Raw events remain in their original collections and are used as evidence. They are
not themselves prompt truth.

## Promotion and Conflict Policy

Authority is ordered:

`explicit user > course setting > validated assessment > repeated behavior > single inference`

- Explicit preferences and corrections promote immediately.
- Repeated lesson feedback becomes a candidate first and promotes only after at
  least three matching signals with 67% dominance.
- Derived personas remain candidates unless the learner states the profile.
- A higher-authority conflicting value closes the old validity interval rather than
  overwriting history.
- Lower-authority conflicts are preserved as contradicted records and cannot replace
  an active higher-authority memory.
- User-deleted inferred memories are tombstoned so the same historical events do not
  silently recreate them.

## Decay and Learning State

- Explicit user preferences and course settings do not passively decay.
- Behavioral observations use confidence half-lives and expire below the configured
  effective-confidence floor.
- Skill state uses a Beta posterior from evaluated exam turns.
- Skill strength decays toward uncertainty according to evidence-dependent stability,
  rather than deleting the state after a fixed TTL.
- Prompt-only recall sessions remain useful activity records but are intentionally not
  mastery evidence.

## Product Integration

- Lesson personalization merges active Memory V2 preferences, decayed skill strength,
  and unresolved misconceptions.
- Doubt answers receive a compact learner-memory block for pacing and explanation
  choices. The prompt explicitly forbids treating learner memory as factual evidence.
- Style/persona changes, repeated lesson feedback, and finalized exams refresh Memory
  V2 and invalidate the legacy profile cache.
- Course deletion cascades through all Memory V2 collections.

## User Controls

`/settings` now includes a Learner Memory panel:

- View active preferences/profile facts.
- Correct a record. The correction becomes a new explicit-user record and the old
  record remains in history.
- Forget a record. Course-backed settings are removed too, preventing recreation.
- Inspect qualitative assessment-backed skill state and unresolved misconceptions.

The API is available at:

- `GET /api/memory`
- `PATCH /api/memory`
- `DELETE /api/memory?memoryId=...`

## Verification

Run:

```powershell
npm run verify:memory
```

The deterministic check covers normalization, preference decay, explicit-memory
non-decay, skill forgetting, and the prompt trust boundary.
