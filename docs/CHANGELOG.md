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
