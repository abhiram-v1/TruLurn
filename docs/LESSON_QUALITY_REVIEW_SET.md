# Lesson Quality Review Set

Use this fixed set after any major change to lesson prompts, planning, grounding, or parsing.
The automated quality gate must pass first. Human review then checks whether a technically
acceptable page is genuinely useful to learn from.

## Acceptance Rubric

Score each dimension from 1 to 5.

- Correctness: claims, definitions, procedures, formulas, and boundaries are accurate.
- Target understanding: the page produces the realization promised by its learning brief.
- Prerequisite fit: it neither assumes missing knowledge nor repeats established knowledge.
- Explanation quality: the learner gets a causal model, not a fluent list of facts.
- Example relevance: the example exposes the mechanism and matches the learner level.
- Continuity: the page builds on prior pages and prepares the next step without repetition.
- Cognitive load: scope, terminology, paragraph size, and detail are proportionate.
- Source faithfulness: source-grounded pages teach only supported material and cite it correctly.

A sample passes when:

- No dimension scores below 3.
- Correctness and source faithfulness, when applicable, score at least 4.
- The average score is at least 4.
- The reviewer would trust the page as the learner's primary explanation.

## Fixed Samples

### 1. Beginner Machine Learning Introduction

- Learner: beginner with basic programming knowledge.
- Target: distinguish learning from data from manually encoding every decision rule.
- Expected: a direct conceptual opening, one revealing example, and a boundary against "machine intelligence."
- Reject: spam-filter opening, source commentary, definition-first prose, or a list of applications.

### 2. Intermediate Calculus: Chain Rule

- Learner: understands derivatives of simple functions.
- Target: recognize composition and explain why derivative effects multiply through layers.
- Expected: intuition before notation, one complete worked derivative, and a composition mental model.
- Reject: formula-first presentation, unexplained symbols, or several shallow examples.

### 3. Expert Databases: Serializable Isolation

- Learner: experienced developer who knows transactions and common isolation levels.
- Target: reason about serialization anomalies and the trade-off between guarantees and concurrency.
- Expected: precise terminology, a concrete schedule, and no beginner-level padding.
- Reject: generic ACID recap, vague correctness claims, or missing boundary cases.

### 4. Narrow Source-Grounded Chapter

- Learner: intermediate.
- Input: one chapter that teaches a limited mechanism and assumes outside prerequisites.
- Target: teach only the mechanism supported by the chapter.
- Expected: direct synthesis with valid citations and prerequisite gaps kept explicit.
- Reject: invented full-course coverage, canonical prerequisite topics, or "the source says" narration.

### 5. Second Page Continuity

- Learner: beginner.
- Context: page one established the central concept and a running example.
- Target: deepen one mechanism without reteaching page one.
- Expected: reuse the established example and make one explicit conceptual connection.
- Reject: repeated introduction, abandoned example, or a disconnected mini-essay.

### 6. Compact Bridge Page

- Learner: intermediate.
- Target: connect two already-understood ideas in a short transition.
- Expected: a focused micro or short page that explains the missing relationship and stops.
- Reject: forced full-page length, unnecessary quiz material, or a new unrelated concept.

## Acceptance Gate Policy

A page is accepted when it clears the score threshold (75) AND carries no
hard-block issue. Hard blocks are reserved for pages that are broken or unsafe
to show, regardless of score:

- Missing substantive core (no real explanation).
- Unfinished or placeholder content.
- Source-grounded page without verified citations.

Every other critical issue (canned openings, missing examples, weak reasoning,
repetition, etc.) is a quality signal already folded into the weighted score. A
complete page that still clears the threshold despite one is served rather than
dead-ended — these criticals lower the score and feed the one repair attempt,
but they no longer hard-reject a high-scoring page. This keeps a single
stylistic heuristic from blocking an otherwise strong lesson.

## Regression Failures

The automated suite must still detect (report as issues) and, where the page
also fails the score bar or is a hard block, reject:

- Canned hypothetical and stock-example openings.
- Source or document commentary in lesson prose.
- Missing required examples.
- Shallow definitions without explanatory reasoning.
- Internal and previous-page repetition.
- Padding beyond the planned page mode.
- Architecture content-kind mismatches.
- Missing prerequisite repair.
- Unsupported source-grounded claims or missing citations (hard block).

## Review Record

For each major generator change, record:

- Date and change identifier.
- Samples reviewed.
- Dimension scores.
- Regressions found.
- Whether the change is accepted, revised, or rolled back.
