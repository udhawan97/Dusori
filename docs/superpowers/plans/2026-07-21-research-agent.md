# Research agent — implementation plan

Implements [2026-07-21-research-agent-design.md](../specs/2026-07-21-research-agent-design.md).
Target release: **v0.5.0**.

Every task is TDD: write the failing test first, then the smallest implementation
that passes, then run `pnpm test:unit` for the touched package.

## Phase A — preparation refactors (no behavior change)

### A1 · Companion route plugins

`packages/companion/src/routes/workspace.ts` and `routes/research.ts` each export a
Fastify plugin taking the options they need (`root`, `research`). `createServer`
keeps Fastify construction, CORS, the auth hook, static serving, and two
`server.register(...)` calls. `server.test.ts` passes unchanged.

### A2 · Provider display seam

`ResearchProvider` gains:

- `capturedVia(candidate: ResearchCandidate): string` — replaces the panel's
  `provider.id === 'mslearn' ? 'catalog-reference' : 'api-extract'` ternary.
  MS Learn returns `search-reference` for a ranked (URL-keyed) candidate and
  `catalog-reference` otherwise — fixing the current mislabel; Wikipedia returns
  `api-extract`.
- `describeMeta(candidate: ResearchCandidate): string` — replaces the panel's
  `metadata()` provider switch.

`ResearchPanel.svelte` calls both through `providerFor(candidate)`.

### A3 · Delete the unused `AIProvider` placeholder

Remove from `packages/core/src/adapters.ts` (zero implementations, zero
consumers). Phase C designs the real seam against its first callers (ADR-007).

## Phase B — deterministic agent

### B1 · Candidate model

`research/types.ts`: `ResearchProviderId` widens to `string`;
`ResearchCandidate` gains optional `kind`
(`article | repo | paper | qa | docs | course`), `publishedAt` (ISO),
`communityScore` (raw votes/stars/points), and `signals: string[]`.

### B2 · Ranking (`research/rank.ts`, `research/reputation.ts`)

`rankCandidates(query, candidates, { now, seen })` → `RankedCandidate[]`
(`rankScore`, `reasons[]`, `isNew`). Components, each contributing a visible
reason: term relevance (reuses `scoreCandidate`), community score
(log-normalized within its own provider), recency decay (unknown date = neutral),
curated domain reputation (reorder-only, `reputation.ts`).
`selectTopFive(ranked, limit)` greedily enforces kind diversity.
Pure functions, golden-tested.

### B3 · Providers

One file + one test per provider in `research/providers/`, registered through a
new `createResearchProviders({ companion })` factory in `providers/index.ts`
(moves the panel's mslearn-swap logic into core).

| File               | Transport                            | Signals                |
| ------------------ | ------------------------------------ | ---------------------- |
| `hackernews.ts`    | `hn.algolia.com` (app-direct)        | points, comments, date |
| `github.ts`        | `api.github.com` (app-direct)        | stars, last push       |
| `stackexchange.ts` | `api.stackexchange.com` (app-direct) | votes, accepted        |
| `arxiv.ts`         | companion proxy (injected `search`)  | published date         |
| `websearch.ts`     | companion proxy (injected `search`)  | none (vetting only)    |

### B4 · Run memory

`research-file.ts`: `ResearchFileSchema` gains optional `lastRunAt` and
`seen: [{ key, url?, at }]` (additive; no schema-version bump).
`recordResearchRun(storage, topicSlug, candidates, now)` merges seen keys,
caps the list at 500 (drop-oldest), and stamps `lastRunAt`.

### B5 · Orchestrator (`research/agent.ts`)

`runResearchAgent({ providers, query, storage, topicSlug, fetchImpl, now, rerank? })`
fans out to consented providers with a per-provider timeout, merges via
`Promise.allSettled`, filters through `filterResearchSuggestions`, ranks, marks
NEW against `seen`, selects the diverse top 5, records the run, and returns
`{ shortlist, overflow, skipped[] }`. One failing provider never fails the run.

### B6 · Brief (`research/brief.ts`)

`buildDeterministicBrief(query, approved, now)` → Markdown note body with
frontmatter `generated: research-brief`, a visible generator line, sources
grouped by kind with their signals. `briefNoteTitle(query, now)` names the note.

### B7 · Panel

`ResearchPanel.svelte`: one **Run research** action replacing per-provider
buttons; unconsented providers listed as enable chips (existing consent dialog,
zero new cards); shortlist cards show kind badge, signals line, NEW badge;
**Show more** reveals overflow; approve keeps the existing preview → `addSource`
flow and, with a companion, upgrades the capture to full page text (host named
in the preview); skipped providers render inline; **Write research brief**
appears after the first approval.

## Phase C — AI layer

### C1 · Companion AI providers (`packages/companion/src/ai/`)

`ollama.ts`, `openai.ts`, `anthropic.ts` behind one internal interface
(`complete(prompt, { json }) → string`), selected by `config.ts` from env
(`AI_PROVIDER`, else first configured of ollama → anthropic → openai).
Keys never leave the process; no request logging.

### C2 · Companion AI routes (`routes/ai.ts`)

`GET /api/ai/capabilities` → `{ providers: [{ id, model }] }`;
`POST /api/ai/rerank` → per-candidate `{ key, aiScore, note }`;
`POST /api/ai/brief` → Markdown. Same token/origin gates as every other route.

### C3 · Core AI client (`research/ai.ts`)

`createCompanionAiClient({ baseUrl, token, fetchImpl })` with `capabilities()`,
`rerank(query, candidates)`, `writeBrief(query, approved)`. Every method fails
soft: the agent falls back to deterministic order and the brief falls back to
`buildDeterministicBrief`, with a visible "AI unavailable" note.

### C4 · Panel AI surface

AI reliability note per card when present; brief action prefers the AI brief;
the AI consent card (disclosure: candidate titles/snippets/URLs + objective
text, never note contents) gates the first AI call.

## Verification

`pnpm check` (format, lint, typecheck, unit, build) plus `pnpm test:e2e`.
E2E additions use `page.route` fixtures for every companion endpoint.

## Release

Version 0.5.0 across `package.json` files, `CHANGELOG.md`, README roadmap and
product table, `docs/product/spec.md`, ADR-004 and ADR-007 notes, site docs,
companion `--help`/env reference. Then `/update-docs`.
