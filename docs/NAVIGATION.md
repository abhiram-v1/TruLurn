# TruLurn — Navigation Structure

> Three levels of navigation + one separate reflection view.
> These are not the same thing. Do not conflate them.

---

## Level 1 — Big Roadmap

**What it is:** The full subject map. Generated once at course setup. Never changes after that.

**What it shows:** Top-level branches only. For Machine Learning: Supervised, Unsupervised, Self-supervised, Reinforcement Learning. For DSA: Arrays, Trees, Graphs, Dynamic Programming. These are entry points, not content.

**Where it lives:** Its own view. Shown after setup, and accessible from the home screen per course. Not visible during active study.

**Behavior:**
- Clicking a branch enters it and opens the three-panel interface with that branch's roadmap in the left panel
- Branches show a simple state indicator (not started / in progress / mastered) but no granular topic detail
- The shape of the tree is fixed — AI generates it once from the topic and goals

**Not the same as the knowledge graph.** The big roadmap shows structure. The graph shows understanding.

---

## Level 2 — Branch Roadmap (Left Panel)

**What it is:** The working map for an active study session. Lives in the left panel of the three-panel interface.

**What it shows:** Everything inside the branch you entered. Organized by section → topic. For Supervised Learning: Classification (Intro, Decision Trees, SVM, KNN, Logistic Regression) and Regression (Linear, Ridge/Lasso, Polynomial). Topics are ordered with prerequisites respected.

**Where it lives:** Left panel, always visible during a study session. Scoped to the current branch only.

**Behavior:**
- Topics show color state: done (green check) / active (highlighted) / locked (dimmed) / unstable (red dot)
- Clicking an unlocked topic navigates to it
- Clicking a locked topic shows: "Complete [prerequisite] first"
- No jumping into locked topics — enforced, not just discouraged
- Small nudge at the bottom: weakest connection in graph → "Feature scaling is isolated" → taps into graph view

**Scrollable** if the branch has many topics. Does not paginate — the full branch tree is always visible.

---

## Level 3 — Lesson Pages (Middle Panel)

**What it is:** The actual content. One topic broken into 4–8 pages.

**What it shows:** AI-authored explanation of a single topic, one page at a time. Paginated like a book — not scrolling.

**Where it lives:** Middle panel of the three-panel interface.

**Behavior:**
- Prev / next navigation only. No random access within a topic.
- Page header shows: topic name · page N of M
- Page-level controls: Simplify / Go Deeper / Add Example — rewrites that page in place
- Inline rewrite: select any text → mini prompt bar → AI rewrites that fragment in place, full page sent as context
- No chat input anywhere in this panel
- Export available per topic or per full branch: PDF, Markdown, Flashcards

**Generation:** Pages are generated progressively as the user arrives at them, not all upfront. Page 1 generates when the topic is opened. Page 2 generates when page 1 is completed. Stored in the database after first generation — never regenerated unless the user explicitly requests a rewrite.

---

## The Knowledge Graph — Separate View

**What it is:** A reflection tool. Not navigation. Opened intentionally, not during active study.

**What it shows:** The entire course across all branches. Every topic as a node, every conceptual dependency as an edge. Two layers simultaneously:
- Structural layer (fixed): the ground truth of how topics connect, built at course creation
- Mastery layer (live): node color = your understanding state, edge thickness = how well you've connected two topics together

**Where it lives:** Accessible via the graph icon in the bottom nav. Full canvas view — not embedded in any panel.

**Key insight:** A node can be green (mastered) but its edge to another node can be thin. You understood both topics individually but never connected them. That's what the graph surfaces. Surface-level learning made visible.

**Updates:** Not real-time. Recalculates on explicit triggers — quiz completed, topic marked done, doubt session ended. Never updates mid-session.

**One graph per course.** Not one per branch, not one per topic.

---

## How They Relate

```
Course home
    └── Big roadmap (Level 1)
            └── Click a branch
                    └── Three-panel interface
                            ├── Left:   Branch roadmap (Level 2)
                            ├── Middle: Lesson pages (Level 3)
                            └── Right:  Doubt chat (scoped to current page)

Bottom nav (always accessible)
    ├── Home
    ├── Graph  ← knowledge graph, separate view
    └── Settings
```

---

## Common Confusions — Clarified

| Question | Answer |
|---|---|
| Is the big roadmap the same as the knowledge graph? | No. Roadmap = where you are in the subject. Graph = how deeply you've connected what you've learned. |
| Does the left panel show the whole course? | No. Only the current branch. The big roadmap shows the whole course. |
| Can you access the knowledge graph during a study session? | Yes, via bottom nav. But it's a separate view — it doesn't replace or interrupt the three-panel layout. |
| Does the graph update live as you read pages? | No. Only on triggers: quiz done, topic done, doubt session ended. |
| Are lesson pages generated all at once? | No. Generated one at a time as the user arrives at them. Stored after first generation. |
