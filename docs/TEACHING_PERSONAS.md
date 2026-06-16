# Teaching Personas

Teaching personas are the single source of truth for how TruLurn teaches and interacts. They control lesson delivery, explanation shape, agent interaction, quiz framing, and recall cues. Course scope, source fidelity, learner knowledge, learning purpose, and assessed concept state remain separate inputs.

## Available Personas

`immersive_builder` remains the default.

Its core movement is:

1. Start from meaning.
2. Move toward precision.
3. Close with something usable.

It does not force one lesson template. The persona selects a path for major concepts, technical concepts, continuations, supporting ideas, or mathematical material.

`investigator` teaches by inspecting anomalies, failures, evidence, tempting wrong explanations, and the mechanism that resolves them.

It selects among major mystery, failure analysis, technical definition, mathematical mechanism, continuation, and support paths. It does not force a mystery where direct clarity is better.

## Architecture

- `lib/personas/types.ts`: shared persona contracts.
- `lib/personas/immersiveBuilder.ts`: persona definition, page-path selection, and surface directives.
- `lib/personas/investigator.ts`: Investigator definition, adaptive investigation paths, and surface directives.
- `lib/personas/index.ts`: registry, default resolution, and the public directive builder.
- Courses persist `teaching_persona` and `teaching_persona_version`.
- Existing courses without a persona resolve to `immersive_builder`.
- New courses can select either persona during setup, and the agent can switch personas by name.

The same directive builder is used by:

- lesson generation
- agent chat
- quizzes and learning checkpoints
- recall breaks

## Removed Controls

The old lesson-style catalog, automatic style classifier, selectable style presets, free-form persistent style directives, and style-change action were removed. Learner background is now named `learner_audience` so it cannot be confused with the teaching persona.

Knowledge level, learning purpose, learner state, and source coverage calibrate the persona. They do not define a second teaching behavior system.
