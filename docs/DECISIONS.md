# TruLurn — Design & Architecture Decisions

> Why things are built the way they are. Prevents re-litigating the same decisions.

---

## Decision Log

### D-001 — No chat input in the lesson panel. Ever.
**Decision:** The middle panel (lesson) has zero text inputs. Controls are buttons only (Simplify, Go Deeper, Add Example).  
**Reason:** Mixing free-form chat with structured lesson content destroys the cognitive isolation that makes TruLurn different from "ChatGPT with folders." The three panels must have strict, non-overlapping roles.  
**Status:** Final. Do not revisit.

---

### D-002 — Lesson content is generated once, stored, not regenerated per visit
**Decision:** All lesson pages are created at course setup via Anthropic Batch API and stored as markdown in the `pages` table. The AI does NOT re-generate on every visit.  
**Reason:** Token cost, consistency, and speed. Users expect a book — not a different version of the page every time. Batch API costs 50% less.  
**Status:** Final.

---

### D-003 — Mode B (AI as teacher) is the only MVP entry mode
**Decision:** Users describe their topic; AI generates all content from its own knowledge. Mode A (source upload / PDF parsing) is post-MVP.  
**Reason:** Mode A requires document chunking + embedding pipeline (pgvector). Mode B is faster to build and validates the core loop. UI will show a clear hallucination warning for Mode B.  
**Status:** Final for MVP. Mode A planned for v1.1.

---

### D-004 — No numerical scores. Color states only.
**Decision:** Users never see a score like "72%" or "Level 3/5." They see color states: Unstable / Partial / Functional / Mastered.  
**Reason:** Numerical scores encourage gaming and false precision. Color states communicate actionable meaning without inviting comparison or anxiety.  
**Status:** Final.

---

### D-005 — Doubt chat history is per-topic, not global
**Decision:** Each topic has its own isolated chat history. When you switch topics, the chat history resets to that topic's history.  
**Reason:** Global chat history creates cognitive bleed. The doubt chat is a tool for the current topic — not a persistent AI assistant.  
**Status:** Final.

---

### D-006 — Quiz uses Anthropic Batch API for pool generation
**Decision:** A pool of 10 questions per topic is generated at course setup via Batch API. Per-quiz session, 4–5 questions are sampled from the pool.  
**Reason:** Batch API = 50% cost reduction. Questions are stored in the database and reused. Pool only regenerates if the topic is downgraded to Unstable and the pool is considered stale.  
**Status:** Final.

---

### D-007 — Haiku gates all doubt chat messages before Sonnet is called
**Decision:** Every doubt message first hits a Haiku relevance classifier. If off-topic, Sonnet is never called and the user gets a redirect message.  
**Reason:** Prevents expensive Sonnet calls for off-topic chatter. Also enforces the product's core rule: the doubt chat is scoped to the current topic.  
**Status:** Final.

---

### D-008 — Supabase for everything (no separate services in MVP)
**Decision:** Supabase handles Postgres, Auth, and Storage. No Redis, no separate vector DB, no message queues.  
**Reason:** Solo build. Every additional service is overhead. Supabase covers all MVP needs. pgvector is available in Supabase for Mode A when needed.  
**Status:** Final for MVP.

---

### D-009 — Roadmap state updates only on explicit triggers, not per message
**Decision:** Topic state (locked/partial/mastered/unstable) only changes after: quiz completed, session ended, or manual admin action. Not after every doubt message.  
**Reason:** Per-message state updates would be noisy, expensive, and confusing. Ground truth comes from the quiz, not from chat behavior.  
**Status:** Final.

---

<!-- Add new decisions above this line -->
