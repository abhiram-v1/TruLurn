# TruLurn — Changelog

> Every meaningful code change goes here. One entry per session or per feature.  
> Format: `[Date] — File(s) changed — What changed — Why`

---

## How to Add an Entry

```
### [YYYY-MM-DD] — Short title
**Files:** `path/to/file.ts`, `path/to/other.tsx`  
**What:** What was added, changed, or removed.  
**Why:** One sentence on the reason.  
**Status:** done | in-progress | blocked
```

---

## Log

### [2026-07-10] — Removed dead legacy lesson prompt (~750 lines)
**Files:** `lib/topic-pages/generateTopicPage.ts`
**What:** Deleted `LEGACY_LESSON_SYSTEM`, `LEGACY_USER_TEMPLATE`, `legacyKnowledgeLevelDirective`, and `legacyLearningPurposeDirective` — confirmed dead code (declared, not exported, zero references anywhere in the codebase or its tests) implementing a materially different, more elaborate lesson-writing approach (a 7-step "realization arc," per-knowledge-level section menus) that was never the prompt actually in force. File dropped from 2189 to 1436 lines. Done via individually reviewed edits, not a scripted bulk deletion, per the founder's explicit go-ahead in the prior turn. Verified the seams at each removal point (SYSTEM → USER_TEMPLATE, and around the two removed helper functions) preserve the file's existing single-blank-line spacing convention. All 219 tests pass; typecheck clean.
**Why:** Flagged in the previous session as a discovered risk (a future prompt edit could land in the dead copy instead of the active one) and left for an explicit decision rather than bundled into the pedagogical prompt-quality pass; founder approved removal.
**Status:** done

### [2026-07-10] — Model routing: GPT-5.5 for content, Gemini exclusively for graph
**Files:** `lib/ai/routeOwnership.ts`, `lib/ai/routing.ts`, `lib/ai/routeOwnership.test.ts`, `lib/ai/taskRouting.test.ts`, `docs/AI_PROVIDERS.md`
**What:** (1) `COURSE_PLANNING_ROUTE_OWNERSHIP` (curriculum preview/generation, topic plan analysis) bumped from locked `gpt-5.4` to locked `gpt-5.5`. (2) New `LESSON_WRITING_ROUTE_OWNERSHIP` locks `topic_page_generation` (individual lesson-page writing) to `gpt-5.5`, provider/model unoverridable via env — previously this feature had no ownership lock and could silently run on Gemini via the global `AI_PROVIDER` fallback. (3) `GRAPH_MAINTENANCE_ROUTE_OWNERSHIP` (graph_interaction_analyzer, graph_manager, graph_recommendation) flipped from locked OpenAI to locked Gemini (`gemini-3.1-flash-lite`, matching `graph_generation`'s existing model) — every graph-related AI path (generation + maintenance) now runs exclusively on Gemini with no OpenAI fallback possible. Confirmed via audit that TrueViz/DataChart is prompt-embedded content inside lesson generation (not a separate AI feature), so it correctly stays on GPT-5.5 as part of lesson prose, not the graph pipeline. Updated both ownership tests and taskRouting tests to assert the new locks, including override-attempt tests proving the locks hold against `AI_FEATURE_*_PROVIDER` env vars. Updated `docs/AI_PROVIDERS.md`'s Course Planning Ownership section (was incorrectly stating lesson prose was NOT covered by an ownership lock) and added a new Graph Ownership section. All 219 tests pass; typecheck clean.
**Why:** Founder wants content-heavy generation (course + lesson pages) on GPT-5.5 for stronger pedagogical reasoning, and every graph/diagram/mind-map/flowchart-related AI path exclusively on Gemini with zero GPT fallback.
**Status:** done

### [2026-07-10] — Lesson prompts: mental-model-first, anticipate confusion, cross-course coherence
**Files:** `lib/topic-pages/generateTopicPage.ts`, `lib/ai/skills/curriculumPrompt.ts`
**What:** Added a new `TEACHING PRINCIPLES` directive to the lesson writer's active SYSTEM prompt, covering five principles from the founder's brief that weren't yet explicit: (1) mental-model-before-definition / why-before-how, with a paired weak/strong example matching the style that already worked for the earlier definition-unpacking fix; (2) build complexity gradually — one layer of difficulty at a time, generalize only after the core case lands; (3) anticipate confusion inline, before it forms, rather than only via the gated `<misconceptions>` section; (4) connect forward to concepts the course will need again, not just backward; (5) a concrete banned-generic-AI-phrasing list ("in today's fast-paced world", "it's important to note that", "let's dive in", etc.) plus an explicit "this is a learning page, not a chat reply" framing. Tightened the existing progressive-depth INVARIANTS bullet to point at the new directive instead of restating it, avoiding duplication. Added one cross-course-coherence bullet to both the AI-teacher and source-grounded curriculum prompts (`lib/ai/skills/curriculumPrompt.ts`) instructing the planner to use prerequisites for genuine conceptual dependence — so later lessons can honestly say "you already know this" — rather than treating prerequisites as outline order. All 219 tests pass; typecheck clean.
**Why:** Founder asked for a pipeline-wide redesign around progressive disclosure, why-before-how, gradual complexity, and cross-lesson coherence, informed by (not imitating) how frontier models structure educational content.
**Status:** done — one item deliberately deferred, see below

### Investigation note (not applied — flagged for a decision)
While auditing the lesson-writer prompt, confirmed that `LEGACY_LESSON_SYSTEM`, `LEGACY_USER_TEMPLATE`, `legacyKnowledgeLevelDirective`, and `legacyLearningPurposeDirective` in `lib/topic-pages/generateTopicPage.ts` (~700 lines total) are fully dead code — declared, not exported, and never referenced anywhere else in the codebase or its tests (verified by grep). They contain a materially different, more elaborate lesson-writing approach (a 7-step "realization arc," per-knowledge-level section menus) that is NOT the prompt actually in force — `SYSTEM` is what's used. Left in place rather than deleted: a bulk deletion of this size was flagged as a destructive action needing explicit direction rather than being bundled into an unrelated prompt-quality pass. Worth a deliberate yes/no from the founder — removing it would reduce the risk of a future edit landing in the wrong (dead) prompt.

### [2026-07-10] — Lesson pages: fix the robotic voice, not just the structure
**Files:** `lib/topic-pages/generateTopicPage.ts`, `lib/personas/minimalLesson.ts`
**What:** Founder's follow-up: the definition→keyword→why-it-matters→example flow was already in the prompt, but pages still read robotic — because 50+ structural rules tell the model WHAT moves to make and none show HOW they should sound, so the model complies mechanically (glossary-style "'X' means Y. 'A' means B." term-by-term walks with identical sentence skeletons). Added a "DEFINITION UNPACKING VOICE" block to the SYSTEM prompt with a contrastive example — a banned robotic version and a required alive version of the same explanation — since models imitate examples far better than they obey adjectives. Added a "STRUCTURAL VARIETY ACROSS PAGES" rule telling the writer to check previous-pages excerpts and not repeat the same opening move or paragraph rhythm as the immediately preceding page. Added one compact reinforcement line to the minimal-lesson persona directive (kept short — this file has a 1000-char test guardrail by design; the fuller explanation lives in SYSTEM where the budget is unconstrained). All 208 tests pass, including the two length-guardrail tests that initially broke on a longer first draft of the persona addition.
**Why:** Confirms the structural fix alone doesn't solve "feels robotish" — sameness and mechanical term-walking are a voice problem, not a sequencing problem, and voice needs an example to imitate, not another rule to obey.
**Status:** done

### [2026-07-10] — Lesson pages: orient before teaching, pace for beginners
**Files:** `lib/topic-pages/generateTopicPage.ts`, `lib/personas/minimalLesson.ts`
**What:** Three prompt fixes for "lessons dive in with no intro and move too fast". (1) New TOPIC OPENING directive injected on page 1 of every topic: 2–4 sentences of substantive orientation before the first concept heading (what the topic is, why it comes now, what the learner will be able to do), widening to a course-level orientation paragraph when position context shows it's the first topic of the whole course. Explicitly forbids announcement phrasing so it passes the existing opening-quality gate untouched; the SYSTEM "protect the first impression" invariant and the minimal-lesson "begin directly inside the concept" rule both carry a matching exception so the three directives don't fight. (2) Beginner knowledge calibration gains real pacing rules: one new idea at a time, ground every new term before the next, explicit transitions, depth over breadth within the fixed word budget. (3) Global pacing line in the signal-density contract: a new concept must be grounded before the next arrives — compression that skips grounding is named a failure mode equal to padding. Density/anti-padding rules and the formal-first definition order are otherwise unchanged. Affects newly generated pages only.
**Why:** Founder reported lessons feel like pasted content with no orientation (confusing for beginners) and that generation rushes; root cause was density rules with no orientation allowance anywhere and a 3-line beginner directive with zero pacing guidance.
**Status:** done

### [2026-07-10] — Course plans: show the full tree, guarantee named concepts
**Files:** `components/setup/CurriculumPreview.tsx`, `app/styles/study.css`, `lib/ai/skills/curriculumPrompt.ts`, `lib/course-generation/goalCoverage.ts` (new), `lib/ai/types.ts`, `lib/ai/routing.ts`, `app/api/generation-jobs/[jobId]/events/route.ts`
**What:** Four fixes from the "plans look small/abstract and drop named concepts" investigation. (1) The curriculum review screen now renders the FULL recursive topic tree — sub-topics at every depth are visible, editable, reorderable, deletable, and collapsible (default expanded), with per-row "add sub-topic"; previously children rendered only as an "N sub-topics" count badge, hiding most of the plan. (2) `countTopics` now counts recursively (grandchildren were uncounted, understating the stat pill). (3) Prompt contract: concepts the learner explicitly names in the goal are now mandatory coverage in both AI-teacher and source-grounded prompts (source mode still refuses to invent untaught content — uncovered named concepts stay in out_of_scope). (4) New advisory goal-coverage audit (`goal_coverage_check` feature, fast tier): after curriculum generation the worker asks a fast model to extract explicitly named concepts and semantically match them against the plan's topic titles; the report is stored on the curriculum and the review screen shows "You asked for these, but they aren't in the plan yet" with per-concept Add-as-topic / Skip actions. Check is non-blocking; failure just hides the warning. All 208 unit tests pass; typecheck clean.
**Why:** Founder reported plans feeling tiny and abstract with explicitly requested concepts missing; investigation showed the UI hid the tree's substance, and nothing in the pipeline enforced or verified named-concept coverage.
**Status:** done

### [2026-07-09] — Vintage paper texture as the default surface
**Files:** `app/globals.css`
**What:** Added a full-viewport fixed overlay (`body::after`, multiply blend, pointer-events none, above all views) that renders three self-contained layers: fine SVG turbulence grain (200px tile, warm tint, alpha 0.30), coarse low-frequency mottling for aged-fiber variation (600px tile, alpha 0.11), and a soft warm edge vignette. First pass (0.55/0.20 alphas) turned the whole UI muddy khaki and drowned the cream base — tuned down so the grain is clearly visible on flat surfaces while `#fdf7ed` still reads as the base color. Dark theme switches to soft-light at 0.55 opacity so the texture doesn't muddy dark surfaces; disabled entirely in print. Tuning knobs are the two feColorMatrix alpha values, documented in a comment.
**Why:** Founder wants the whole product to feel like vintage paper by default — texture present and recognizable, not a background whisper.
**Status:** done

### [2026-07-09] — Knowledge graph: declutter so the graph is the hero
**Files:** `components/graph/GraphClient.tsx`, `components/graph/GraphDetailPanel.tsx`, `app/styles/graph.css`
**What:** (1) Removed the floating orientation HUD ("On your map / mastery % / Stage / Next / Recenter") — recenter already exists in the zoom cluster and the rest duplicated sidebar/panel data. (2) Removed the floating legend card (sidebar already has the same legend). (3) Topbar trimmed to back/brand, breadcrumbs, view toggle, and search; removed its progress bar, Center, Connect, Atlas, and Continue-study buttons (all exist elsewhere — Connect moved into the detail panel's Actions). (4) The right detail panel now only mounts when a node is clicked (no more always-on course-overview state, which duplicated sidebar stats), can be collapsed via a ❯ button in its header, and reopened via a ❮ edge tab; the canvas reflows to full width via `grid-template-columns: … auto` instead of a fixed 320px column. (5) Removed auto-select-on-load so the graph opens clean. (6) Inside the panel, removed the redundant "Learning signal" bar (state pill already in header) and the "Tags" section (all four tags restated data shown above). Dead CSS for hud/legend-card left in place (elements no longer render; theme overrides reference them).
**Why:** Founder said the graph view felt chaotic with overlays covering the canvas; goal is that the graph itself holds the focus and nothing sits on top of it.
**Status:** done

### [2026-07-09] — Lesson feedback: capture a reason after negative signals
**Files:** `components/learn/LessonFeedback.tsx`, `app/styles/study.css`, `app/api/lessons/feedback/route.ts`
**What:** After a student picks "Lost me" or "Too basic", the feedback bar now shows one-tap reason chips (e.g. "Too much jargon", "Moved too fast", "Already knew this", "Wanted more depth") plus an "Other" option with a short free-text field, or a "Skip" to dismiss without giving one. The chosen reason/note is sent as a follow-up call to the same `/api/lessons/feedback` endpoint and merges onto the same MongoDB document via the existing upsert (keyed by user/course/topic/page), so `lessonFeedback` documents now carry `signal`, `reason`, and `note` together. No UI currently reads this beyond the existing level-shift logic — this is intentionally just the data-capture wire (per founder: build the pipe now, connect a dashboard later).
**Why:** Founder wants to know not just that a page didn't land, but why, and wants the data queryable in Mongo now so nothing is lost while the review surface (dashboard/email digest) is still undecided.
**Status:** done — dashboard/notification layer intentionally deferred

### [2026-07-09] — Landing page rewrite: plain copy + visual polish
**Files:** `app/page.tsx`, `app/styles/landing.css`
**What:** Rewrote all landing copy in plain, direct language — removed the "AI-guided mastery system" eyebrow, slogan-y phrases ("honest quizzes", "a map that tells the truth", "study with structure, not panic"), and most "not X, but Y" constructions. Replaced the abstract floating-node hero graphic with a CSS-built three-panel app mock (roadmap rail with semantic state dots, lesson panel with a recall-check callout, doubt-chat column) so visitors see the actual product shape. Feature cards now use small Tabler icons instead of big index numbers; how-it-works is a 4-column hairline-ruled grid; FAQ is a divided list instead of cards; hero proof pills became a single muted text line. Brought all font weights into compliance with the 400/500 rule (was using 600/700 on headings, brand, and labels). Added a subtle masked grid backdrop to the hero.
**Why:** Founder said the landing page looked basic and the copy read like AI marketing filler; goal was a professional Linear/Notion-grade page in normal language. Follow-up: replaced the comparison headline ("Most learning tools track completion. TruLurn tracks understanding.") with a curiosity question ("How much of what you study actually sticks?") per founder feedback that it read as competitor-comparing; sub now introduces TruLurn by name.
**Status:** done

### [2026-06-14] — Immersive Builder: define formal-first, once (fix double definition)
**Files:** `lib/personas/immersiveBuilder.ts`
**What:** Revised the `major_concept` lesson path so the definitional moment is precise-definition-first then plain-language unpacking, as a single pass. Previously step 3 ("build the concept from intuition into precise language") produced a casual definition early and step 4 ("Include the formal definition") restated it formally later — so the learner read the same definition twice in two registers, with a separate "Formal definition" section. New path: define each term once, precise first, then unpack key words; do not restate a separate "formal definition" later; the exam/interview-ready subsection must be a tight recall scaffold, not a re-explanation; each section must advance rather than repeat. Bumped persona version 1→2 (record-keeping; does not gate regeneration). Kept the intuitive problem-first opening, the worked example, and the exam-ready subsection intact.
**Why:** Founder reported the formal definition appearing after an informal one ("learning the same thing twice in different languages") and asked to reverse the order without pruning; also reduces the repeated concept/exam framing. Takes effect on newly generated pages; existing pages are unchanged unless regenerated.
**Status:** done

### [2026-06-14] — DataChart: fix legend/axis-title overlap and small axis text
**Files:** `components/trueviz/DataChart.tsx`
**What:** Moved the legend to the top (`verticalAlign="top"`) on bar/line/area charts so it no longer collides with the x-axis title that sits in the bottom strip. Bumped axis tick text 11→13px and axis titles 11→14px/weight 500 for legibility. Added a `leftMargin()` helper that widens the left margin to 28px when a y-axis title is present, so the rotated title no longer clips (was truncating, e.g. "Illustrative amount of work" → "Illustrative amount of"). Factored `bottomMargin()`/`leftMargin()` helpers to replace the per-renderer inline values.
**Why:** Reported overlap between the x-axis title and the legend, plus too-small axis/label text; verified the fix in a preview sandbox (legend now above the plot, full y-title, larger ticks).
**Status:** done

### [2026-06-14] — Lesson quality gate: clearer rejection + high-scorers no longer dead-end
**Files:** `lib/topic-pages/lessonQuality.ts`, `lib/topic-pages/lessonQuality.test.ts`, `components/learn/MissingPageGenerator.tsx`, `docs/LESSON_QUALITY_REVIEW_SET.md`
**What:** (1) Rejection message no longer shows the misleading "score 92/75" (a passing score beside the word "failed"); `lessonQualityRejectionReason()` now names the real cause — a hard-block check or a sub-threshold score. (2) Acceptance gate changed from "no critical issue allowed" to "clears threshold AND no hard-block issue" (`HARD_BLOCK_CODES` = missing core / placeholder / unverified source). Non-hard-block criticals (canned opening, missing example, etc.) still lower the score and are reported, but no longer hard-reject a page that clears 75. (3) The generation error screen now lists the specific failing checks instead of a bare number. Updated 2 unit tests to the new policy and added a hard-block test.
**Why:** A page scoring 92/100 was being dead-ended by a single stylistic critical heuristic, and the "92/75 failed" message read like a math error; founder chose to let high-scoring pages through while keeping hard blocks for genuinely broken/unsafe pages.
**Status:** done

### [2026-05-20] — BigRoadmap visual redesign
**Files:** `components/navigation/BigRoadmap.tsx`, `app/globals.css`
**What:** Polished roadmap UI — added horizontal SVG connectors from nodes to cards, moved step numbers inside node circles (removed label below), widened cards from 280→300px with better padding, added 2px top accent border per state (terracotta for in-progress, green for mastered), redesigned state badge with a colored dot indicator and removed uppercase transform, fixed font-weight violations (600→500 on title and badge), enlarged icon box to 38px with a subtle border, taller progress track (5→6px) with a lighter track color, stronger hover shadow and lift, smoothed milestone pills, and changed pulse animation to opacity-only for the in-progress node ring.
**Why:** Roadmap felt flat and generic; state hierarchy was invisible, typography violated the 500-weight rule, and the node numbers were disconnected from the circles.
**Status:** done

---

### [2026-05-19] — Project scaffold
**Files:** `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/CHANGELOG.md`, `docs/COLOR_PALETTE.md`, `docs/DECISIONS.md`, all `_guide.md` files  
**What:** Created full directory structure, CLAUDE.md with all project rules, architecture reference, and guide files for every directory.  
**Why:** Establish single source of truth for all code decisions before writing any feature code.  
**Status:** done

---

### [2026-05-19] — Landing page
**Files:** `app/page.tsx`, `app/globals.css`
**What:** Replaced the placeholder dashboard page with the full public landing page. Nine sections: sticky nav, hero split (headline + library SVG scene), contrast table (other tools vs TruLurn), three isolated spaces (Learn/Ask/Test), cognitive model (5 levels + 4 color states), quiz explanation (3 question types with examples), the learning loop (4 numbered steps), CTA section, footer. Added ~500 lines of landing-specific CSS to globals.css under a clearly marked section. All responsive breakpoints handled at 920px.
**Why:** This is the first page a visitor sees — it needs to represent the product concept honestly and convert visitors to sign up.
**Status:** done

### [2026-05-19] — Learn view UI tightening
**Files:** `components/learn/LearnExperience.tsx`, `components/learn/DoubtChat.tsx`, `components/ui/ContextBadge.tsx`, `app/globals.css`
**What:** Collapsed the double bottom-zone (separate PageNav bar + 4 giant buttons) into a single 46px footer bar with prev/page-pos/segmented-controls/next all inline. Removed Export button (post-MVP). Panel headers reduced from 68px → 44px. Roadmap topic rows reduced from 60px → 40px. Section labels from 14px padding → 6px. Chat textarea auto-heights from 1 row, sends on Enter, context badge moved inline into chat header. Rewrite controls are now a segmented pill button group at ~26px tall instead of 62px tall blocks.
**Why:** The giant buttons dominated the bottom third of the lesson panel; space should go to content, not chrome.
**Status:** done

### [2026-05-19] — Home dashboard SVG artwork fix (v3)
**Files:** `app/page.tsx`, `app/globals.css`  
**What:** Fixed SVG artwork by surgically cropping the viewBox from `"0 0 1593 2048"` to `"0 900 1593 1148"`, which removes the blank upper wall/ceiling portion and starts the visible area at y=900 — exactly where the bookshelf structure begins (confirmed via SVG path coordinates: `L 1593 894.931`). Updated SVG height attribute from 1152→646 to match new proportions. The cropped viewBox ratio is 1593:1148 = 1.387, which almost exactly matches the landscape container (~1.38), so `object-fit: cover` now works correctly with minimal cropping. CSS reverted to `object-fit: cover; width: 100%; height: 100%` and pane background restored to sand.  
**Why:** The portrait image (0.78 ratio) in a landscape container meant `object-fit: cover` zoomed into the featureless center wall; cropping the viewBox to the desk scene gives a matching aspect ratio so cover fills the pane with actual content.  
**Status:** done

<!-- Add new entries above this line, newest first -->
