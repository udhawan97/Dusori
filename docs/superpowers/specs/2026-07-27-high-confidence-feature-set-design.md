# High-confidence feature set design

**Status:** approved · **Date:** 2026-07-27 · **Target release:** v0.6.0

## Purpose

Ten features that extend already-proven seams in Dusori without adding a hosted
backend, an account system, telemetry, or an always-running background process.
Each one reuses an existing tested module boundary. Each ships as its own
vertical slice under ADR-007.

## Out of scope

Two items from the public roadmap are deliberately not built here, because
neither can be implemented without contradicting the product contract in
`docs/product/spec.md`:

- **Remote-page fetching from the hosted app alone.** The browser cannot fetch
  arbitrary third-party pages; CORS forbids it. The only workaround is a proxy,
  and a proxy is a hosted backend. The companion already covers this need.
- **Scheduled or unattended research.** The contract states that Dusori performs
  no closed-app or unattended background work.

Both stay on the roadmap's "planned — not built" list, unchanged.

## Provider reachability, measured

Candidate keyless providers were tested for CORS rather than assumed. Only
these three send `access-control-allow-origin: *` and answer without a key:

| Candidate        | Result                                | Decision                               |
| ---------------- | ------------------------------------- | -------------------------------------- |
| OpenAlex         | 200, `access-control-allow-origin: *` | ship                                   |
| npm registry     | 200, `access-control-allow-origin: *` | ship                                   |
| Open Library     | 200, `access-control-allow-origin: *` | defer — catalog only, no readable text |
| Semantic Scholar | 429, no CORS header                   | reject                                 |
| PyPI             | no JSON search API with CORS          | reject                                 |
| MDN              | no CORS                               | reject                                 |

Reddit is CORS-blocked in the browser, so it ships companion-backed.

## Slices

### 1. Tags

New `packages/core/src/tags/tags.ts`. Parses `tags:` frontmatter (YAML list or
comma-separated) and inline `#tag` from Markdown bodies. Pure, no network, no
stored index.

Three existing consumers gain a tag surface:

- `search/workspace-search.ts` — a `tag:` query operator.
- `graph/workspace-graph.ts` — tags as a graph facet, reusing the existing
  colour-by and filter controls.
- `analytics/workspace-insights.ts` — a derived tag distribution.

Required behaviours, each a test:

- `# Heading` at line start is a heading, never a tag.
- `#tag` inside a fenced code block or inline backticks is not a tag.
- Frontmatter and inline tags merge, deduplicated, case-preserved but
  case-insensitively compared.

### 2. OpenAlex research provider

`packages/core/src/research/providers/openalex.ts`, one entry in
`researchProviders`. Keyless, browser-reachable. `cited_by_count` maps to the
provider-relative community signal; `publication_year` maps to recency. Egress
disclosure names `api.openalex.org` exactly.

### 3. npm registry research provider

`packages/core/src/research/providers/npm.ts`, one entry in
`researchProviders`. Keyless, browser-reachable. `score.detail.popularity`
maps to the community signal. Egress disclosure names `registry.npmjs.org`.

### 4. Reddit research provider

Companion-backed, built by `createRedditProvider({ search })` in the same shape
as arXiv and web search. The companion adds a Reddit route; credentials and
user-agent stay in the companion process.

Reddit rate-limits aggressively and may refuse a request for reasons unrelated
to this code. The provider therefore rides the existing visible-skip-notice
path: a failure produces a skip notice and never fails the surrounding run.

### 5. Single-topic export

`exportTopic(storage, slug)` in `packages/core/src/portable.ts`, reusing the
existing ZIP builder filtered to `Topics/<slug>/**`.

The result is a **topic bundle**, explicitly not a re-importable workspace.
Scoped import requires merge semantics — how to resolve a slug that already
exists, how to reconcile two `state.json` files — and that is a separate design.
The export UI says so plainly rather than implying a round trip.

### 6. Review-pressure insights

Extends `analytics/workspace-insights.ts` to read each topic's `review.json`
and derive: count due today, count overdue, and a bounded fourteen-day due
histogram.

Constraint carried forward from the existing module: derive only. No persisted
analytics index, no estimated study time, no inferred mastery, no score.

### 7. Health findings become proposals

`graph/workspace-health.ts` stays pure and non-mutating.

A new sibling `graph/health-actions.ts` turns one finding into one action:
create a Markdown file that an existing wikilink already points at. This is
in-contract because the storage rules permit creating new files automatically;
it never rewrites, repairs, or quarantines existing Markdown. Every action
appends to the dated update log.

### 8. Additional recall templates

Extends `learning/recall.ts` with two deterministic template kinds: a cloze
deletion drawn from a source sentence, and a locate-the-section prompt. The
existing rules are unchanged — three to five prompts, fixed order, every prompt
naming its source title, section, and workspace path.

### 9. PDF source import

`pdfjs-dist` is imported lazily in the **app layer only**, never in
`@dusori/core`. This keeps core testable under Node and keeps the offline
application shell from growing by roughly a megabyte for a feature most sessions
never touch.

Extraction runs locally in the browser. The extracted text enters the existing
`sources/import.ts` path at the existing 2 MiB cap, and is hashed, recorded in
the topic manifest, and appended to the dated update log like any other source.

A PDF with no extractable text layer — a scan — produces an explicit error
naming that cause. Dusori ships no OCR.

### 10. TUTOR.md preferences editor, with optional AI chat

The deterministic route is the baseline and works with no companion and no AI.
New `learning/tutor.ts` parses `TUTOR.md` into its frontmatter (`depth`) and its
preference bullets, applies structured edits — set depth, add, remove, or
reorder a preference, set the self-check count — and renders the file back.

The write path is the one that already exists: `proposeMarkdownUpdate`, then
`lineDiff` for review, then `acceptMarkdownUpdate` on explicit acceptance. An
external edit produces a sibling proposal exactly as it does for `roadmap.md`.

With the companion running, a configured AI provider, and a separate consent
covering the file's contents, a chat box may propose a full replacement body
instead. The proposal is labelled with its model, is never applied
automatically, and passes through the same diff and acceptance gate. Any
failure leaves the deterministic editor working.

This mirrors every other AI feature in the codebase: AI is advisory over a
deterministic base that stands on its own.

## Cross-cutting

- **Consent.** OpenAlex and npm each get an exact egress disclosure naming the
  host and what leaves the device, stored per provider on the device. Reddit is
  reachable only with the companion. AI TUTOR chat has its own consent, separate
  from research AI consent.
- **Schemas.** Tags are derived from Markdown and add no schema version. Insights
  and health remain derive-only.
- **Trust model.** No slice sends source text anywhere without a disclosure, and
  no slice replaces user-visible Markdown without a diff and an explicit accept.

## Testing

Test-first per slice. Vitest covers all core logic. Playwright covers the three
journeys a user can see end to end: searching by tag, importing a PDF as a
source, and accepting a TUTOR.md change from the diff view.

## Release

All seven workspace packages move 0.5.0 → 0.6.0 together, preserving the
version-alignment gate. CHANGELOG, product spec, and roadmap are updated so that
shipped and planned stay separated. `graphify --update` runs before the tag.
