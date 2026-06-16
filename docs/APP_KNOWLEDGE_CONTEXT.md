# App Knowledge Context

TruLurn keeps product knowledge separate from course evidence and learner memory.
The agent retrieves this context when a question is about the app itself, then
answers directly from implementation-aligned feature descriptions and live state.

## Architecture

- `lib/agent/appKnowledge.ts` is the canonical product knowledge registry.
- Each entry has stable aliases, a summary, behavioral details, controls, and
  links to related feature entries.
- `shouldRetrieveAppKnowledge` routes product questions without treating ordinary
  subject questions such as computer memory or mathematical graphs as app queries.
- `retrieveAppKnowledge` selects the most relevant entries deterministically.
- `buildAppKnowledgeContext` adds live settings and course/user state where useful.
- `lib/agent/context.ts` injects the result as `PRODUCT KNOWLEDGE CONTEXT`.
- Source-grounded courses do not require uploaded citations for product questions,
  because app behavior is a separate trusted knowledge domain.

## Adding Or Changing A Feature

Update the matching entry whenever user-visible behavior, labels, controls, or
defaults change. Add a new entry when a feature has its own purpose or workflow.
Prefer concrete behavior over marketing language, and include distinctions users
are likely to ask about.

Run:

```powershell
npm.cmd run verify:app-knowledge
```

The verification protects retrieval for common product questions and prevents
ambiguous subject terms from being routed to product knowledge accidentally.
