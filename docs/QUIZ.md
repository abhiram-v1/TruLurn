# TruLurn — Quiz System

> The quiz is the only source of ground truth in TruLurn. Everything else —
> lesson pages, doubt chat, confusion signals — is inference. The quiz is measurement.
> It gets more engineering attention than anything else in the product.
>
> This document covers the hybrid quiz architecture and the dynamic exam engine
> that simulates a real exam using the recursive roadmap as its blueprint.

---

## The Core Problem with Simple Quiz Generation

Most quiz systems do one of two things:

**Pre-generate a fixed pool** — questions written at course setup, served randomly.
Problem: questions are stateless. They don't know what the student just answered,
what they struggled with, or where in the recursive roadmap they currently are.
A student who aced the first four questions gets the same fifth question as a
student who failed all four.

**Generate on demand** — AI writes a question when prompted.
Problem: without context of the full exam so far, the AI repeats concepts,
misses important nodes, and cannot calibrate difficulty progressively.
It's a random question, not an exam question.

Neither simulates an exam. TruLurn needs something different.

---

## The Hybrid Architecture

Two quiz types working together. Neither replaces the other.

```
FULL TOPIC EXAM
  When:    After topic completion, or when student requests via sidebar
  Length:  5–20 questions
  Purpose: Measure mastery of the entire topic
           Update roadmap state at every node level
  State:   Fully stateful — each question depends on all previous answers
  Impact:  Updates roadmap mastery from atomic level upward

SPOT CHECK
  When:    Confusion signal fires (3+ doubts on same concept)
           Student asks for a quick quiz mid-topic
           AI agent decides one is warranted
  Length:  1–3 questions
  Purpose: Probe one specific concept, not the whole topic
  State:   Minimal — just the target concept and current page context
  Impact:  Does NOT update roadmap state
           Feeds confusion signal system only
           Tells the agent whether to adjust next page generation
```

They serve different jobs. The full exam is a checkpoint. The spot check is a pulse.

---

## The Recursive Roadmap as Exam Blueprint

The recursive roadmap is not just navigation — it is the exam specification.
Every node in the tree carries the information needed to decide what to ask,
when to ask it, and how hard to make it.

### What each node knows

```
Node in the recursive roadmap:
  title:         what concept this covers
  depth:         light / medium / important / critical
  level:         position in tree (0=branch, 1=section, 2=topic, 3=subtopic/atomic)
  prerequisites: which nodes must be understood before this one
  coverage:      how much of this node was actually studied (0 to 1)
  mastery:       current estimated understanding level (0 to 1)
  children:      atomic concepts nested inside this node
```

The exam engine reads this tree before generating each question.
It knows what exists, what was studied, what was mastered, and where the student is right now.

### The pointer

The pointer from the generation pipeline carries directly into the exam engine.
Before each question is generated, the full roadmap state is serialized and sent to the AI:

```
[critical] Supervised learning — partial
  [important] Classification — partial
    [medium]   What is classification — mastered
    [critical] Decision trees — partial
      [light]     What is a decision tree — mastered
      [critical]  Impurity measures — studied  ← HERE
      [important] Overfitting — not reached
    [important] SVM — not reached
  [important] Regression — not reached
```

The AI sees exactly where the student is, what they have covered, what they have
mastered, and what is still ahead. It generates a question that makes sense at this
exact position in the exam — not a generic question about the topic.

---

## The Full Topic Exam — How It Progresses

The exam has four phases. The engine moves through them based on what has happened
so far — not on a fixed question count.

### Phase 1 — Warmup

The first 2–3 questions are always easy. Light or medium depth nodes near the
start of the roadmap. Concepts the student almost certainly knows.

This is not charity. It serves a real purpose. Students perform worse when the
first question is hard — anxiety interferes with recall. Starting easy calibrates
confidence, surfaces the student's baseline, and gives the engine early data on
how they communicate answers before the stakes rise.

### Phase 2 — Breadth

The engine walks the recursive tree and covers all critical and important nodes
at least once. It respects prerequisites — it will not ask about information gain
before confirming Gini impurity is understood, because information gain builds on it.

Concept selection is weighted by three factors simultaneously:

**Depth level** — critical nodes are prioritised over medium ones.
An important concept the student studied gets asked before a light concept they studied.

**Coverage** — only nodes that were actually studied get asked.
If the student ran out of time and never reached a subtopic, that subtopic is not
tested. The exam is honest about what was covered.

**Mastery gap** — nodes with low mastery scores get asked before nodes with high ones.
The engine is not trying to prove what the student knows — it is trying to find
what they do not know.

Difficulty rises through this phase. Early breadth questions are moderate.
Late breadth questions are harder. If the student answers well consistently,
difficulty increases. If they struggle, it eases back.

### Phase 3 — Depth

When a concept fails during breadth, it gets added to the weakness list.
The depth phase revisits those concepts from a different angle.

Different angle is important. If a student failed an application question on
entropy, asking another application question on entropy might just reproduce the
same failure. The engine switches question type — if they failed apply, try
spot_error or explain. The goal is to find where exactly the understanding breaks,
not to confirm that it breaks.

### Phase 4 — Verify

Any concept that failed during breadth and was probed during depth needs one
final verification. The engine asks a question at the same difficulty level as
the original failure to check whether the student recovered.

A concept that fails warmup, depth, and verify is marked unstable in the roadmap.
A concept that fails breadth but passes verify is marked partial — they got there
eventually but it was not solid.

### Termination

The exam ends when:
- All critical and important concepts have been covered and no outstanding
  weaknesses remain — natural completion
- The student has answered 20 questions — hard maximum regardless of phase
- The student fails 5 consecutive questions — something structural is wrong,
  the exam is not the right tool right now, stop and surface support

---

## Difficulty — How It Works

Difficulty is computed fresh before every question. It is never fixed.

The base difficulty comes from the node's depth level:

```
light     → difficulty 1
medium    → difficulty 2
important → difficulty 3
critical  → difficulty 4
```

Then three adjustments apply:

**Recent performance** — a rolling score of the last 5 answers.
If the student is consistently correct, difficulty increases by 1.
If they are consistently wrong, difficulty decreases by 1.
This keeps the exam at the edge of the student's competence, which is where
learning and accurate measurement both happen.

**Phase modifier** — depth phase questions are always 1 point harder than base.
The engine is trying to find where the weakness is rooted, not just confirm it exists.

**Verify modifier** — verify questions match the exact difficulty of the question
that originally failed. Testing recovery at a lower difficulty proves nothing.

Difficulty never goes above 5 or below 1.

---

## Question Types by Depth Level

The question type is chosen based on the node's depth and the computed difficulty.
The mapping is not random — it reflects what each depth level actually requires.

```
light topics:
  Always explain — define this, describe this, what does this mean.
  These are definitional nodes. Asking someone to apply a definition
  before they can state it is premature.

medium topics:
  Low difficulty  → explain
  Higher difficulty → apply
  Can they use it, not just state it.

important topics:
  Low difficulty  → explain
  Mid difficulty  → apply
  High difficulty → spot the error
  Spot the error requires understanding the mechanism deeply enough
  to recognise when it breaks. That is the right test for important concepts.

critical topics:
  Low difficulty  → apply (never just explain — critical topics must be applied)
  Mid difficulty  → spot the error
  High difficulty → apply with a novel scenario or edge case
  Critical topics are never tested with pure recall questions.
  If a student can only define backpropagation but cannot apply it or
  identify a broken implementation, they do not understand it.
```

---

## What the AI Receives Per Question

The AI is called once per question. Everything else — phase logic, node selection,
difficulty computation, question type selection — is deterministic engine code.
The AI's job is only to write the question text given a precise specification.

Every generation call receives:

**The full recursive roadmap state** — serialized with coverage and mastery per node,
and the pointer showing exactly where the student is right now.

**The full exam history** — every concept asked so far, the question type used,
the difficulty, whether it passed, and what gap was identified if it failed.

**The current instruction** — which concept to ask about, which question type to use,
what difficulty to target, and any special instructions for the current phase
(verify: ask from a different angle; depth: find the root of the confusion).

This context is what makes the exam coherent. The AI does not generate a question
in isolation — it generates the next question in an ongoing exam, knowing everything
that has happened so far.

---

## What the AI Does NOT Decide

The engine, not the AI, decides:

- Which concept to ask about next
- What difficulty level to use
- Which question type to use
- Whether to end the exam
- Which phase the exam is in
- Whether a concept needs verification
- How to weight nodes during breadth phase

The AI only writes the question text and the rubric for evaluation.
Everything structural is deterministic. This is intentional — it keeps the exam
consistent, reproducible, and explainable. If a student challenges why they were
asked a certain question, the answer is in the engine logic, not in an AI decision
that cannot be audited.

---

## The Exam Result and Roadmap Updates

When the exam ends, the result is not a single score. It is a per-node mastery
update that propagates through the recursive tree.

A student can ace the overview questions and fail the atomic ones. A student can
fail a parent node question but pass all the child node questions — which suggests
they understand the pieces but not the whole. The recursive roadmap captures all
of this precisely.

Mastery updates flow upward through the tree. If all children of a node are mastered,
the parent node's mastery increases. If an atomic node fails, its ancestors' mastery
decreases proportionally by their dependency on that node.

The result also produces:

**A natural language exam summary** — what was strong, what was weak, what to
revisit before moving forward. Not a score. A tutor's assessment.

**Roadmap state changes** — which nodes move to mastered, partial, functional, or
unstable. These drive what happens next in the course. Unstable nodes get flagged
for revisit. Mastered nodes unlock their dependents.

**Confusion signal updates** — any concepts that failed mid-exam are added to the
confusion signal system. The next pages generated for those concepts will be adjusted
accordingly, even if the student moves forward.

---

## The Spot Check — How It Differs

The spot check is not a mini version of the full exam. It is a different tool entirely.

It fires when the agent detects a confusion pattern — the student has asked about
the same concept three times, or the confusion score for a concept hits a threshold.
The agent surfaces 1–3 targeted questions on that specific concept only.

The spot check:
- Does not have phases
- Does not walk the tree
- Does not update roadmap state
- Does not end with a result

It is a diagnostic probe. The agent uses the outcome to decide whether to adjust
the next page generation. If the student passes, confusion signals are cleared for
that concept. If they fail, the adjustment block for the next page intensifies.

The student may not even know it is happening. The agent can frame it naturally:
"Want to quickly check your understanding of this before moving on?" — a question,
not a forced assessment.

---

## Quiz Timing — When Things Generate

### Full topic exam

Quiz planning happens at course setup — the engine knows from the recursive roadmap
which concepts exist, their depth levels, and their prerequisites. No question text
is written yet. Just the structure.

Actual question text generates on demand, one question at a time, as the exam
progresses. Each question is generated only when the previous answer has been
evaluated. The engine cannot know what question to write next until it knows how
the last one was answered.

Pre-generation is not possible for a stateful exam. The question depends on the
answer that precedes it.

The one optimisation: when the student hits the second-to-last page of the last
subtopic in a topic, the engine initialises the ExamState in the background. By
the time the student finishes the topic and clicks start quiz, the state is ready
and the first question generates immediately.

### Spot check

Generates entirely on demand when triggered. No pre-planning. It is short enough
(1–3 questions) that the latency is acceptable.

---

## What Makes This Simulate a Real Exam

A real exam is not a list of questions. It is a dynamic conversation between the
examiner and the student's demonstrated understanding.

TruLurn's exam engine replicates the three things that make real exams rigorous:

**Progressive difficulty** — the exam gets harder as the student demonstrates
competence, and eases back when they struggle. It stays at the edge of their
ability, which is both where accurate measurement happens and where the most
learning happens under pressure.

**Prerequisite respect** — the engine never asks about a concept before confirming
its foundation. If a student cannot explain what impurity is, asking about
information gain is meaningless. The recursive roadmap encodes these dependencies
explicitly and the engine enforces them.

**Recovery testing** — a student who fails a concept and then claims to understand
it must prove that claim. The verify phase exists specifically for this. A concept
is not considered recovered until the student answers a question on it at the
original difficulty level after the failure. This prevents false confidence from
passing through the exam unchallenged.

These three properties, combined with the recursive roadmap providing atomic-level
visibility into what was studied and what was mastered, produce an exam that
behaves like a rigorous human examiner rather than a randomised question generator.

---

## Build Order

### MVP
```
Basic exam after topic completion
Questions generated one at a time with full roadmap state as context
Simple linear walk of the tree — no phase logic yet
Evaluate each answer, update roadmap state
End after fixed question count (8 questions)
Spot check via agent sidebar — on request only
```

### Post-MVP v1.1
```
Phase logic: warmup → breadth → depth → verify → complete
Difficulty adaptation from recent performance
Prerequisite enforcement during node selection
Dynamic termination logic
```

### Post-MVP v1.2
```
Full weakness detection and depth phase probing
Verify phase for failed concepts
Natural language exam summary
Per-node mastery propagation through recursive tree
Confusion signal updates from exam failures
```

---

## Rules

- The AI generates question text only — all structural decisions are made by the engine
- Every question call includes the full roadmap state and full exam history
- Difficulty is computed fresh before every question — never carried over blindly
- Critical topics are never tested with recall-only questions
- Spot checks never update roadmap state — they are diagnostic only
- The exam ends on natural completion, hard maximum, or repeated failure — never mid-phase
- Recovery is only confirmed when the student passes at the original failure difficulty
- Quiz planning (structure) happens at course setup — question text generates on demand only

---

*TruLurn · QUIZ.md · Part of the technical masterplan*
*Read alongside PLAN.md, GENERATION.md, AGENT.md, and MEMORY.md*
