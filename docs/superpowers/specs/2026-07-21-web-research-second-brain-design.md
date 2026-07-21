# Web-research second brain — design

**Status:** implemented · **Date:** 2026-07-21 · **Release:** v0.2.0

## Goal

Dusori should help a learner keep building their knowledge base, not just organize it.
Given a topic with a roadmap — typically an imported certification study guide — Dusori
suggests relevant web material for the objective the learner is working on, and turns
accepted suggestions into normal portable sources with full provenance. The learning
loop stays deterministic; the web becomes an input, never an authority.

Primary scenario: a user imports the AZ-104 study guide (already shipped), works the
roadmap, opens Research, and gets ranked Microsoft Learn modules and Wikipedia
articles for “Configure Microsoft Entra ID”, each one click away from becoming a
source file linked into the topic and the graph.

## Background — what exists and what was verified

Leverage points already in the codebase:

- `packages/core/src/sources/import.ts` — `addSource` gives hashing, dedupe,
  manifest, update-log, and conflict-safe writes. Research acceptance reuses it.
- `packages/core/src/learning/loop.ts` — `progressFromRoadmap().nextObjective`
  is the deterministic seed for research queries.
- `packages/core/src/curriculum/import.ts` — preview-first import is the interaction
  pattern research suggestions copy.
- `packages/core/src/adapters.ts` — `SourceAdapter` and `AIProvider` interfaces were
  reserved for exactly this kind of expansion.
- `packages/companion` — loopback + token + origin allowlist foundation for the
  phase-2 fetch endpoint (ADR-004).
- The workspace graph scans files and wikilinks, so accepted sources appear in the
  constellation with no graph work.
- `docs/product/spec.md` trust model already requires egress disclosure before any
  content is sent to an explicitly selected provider.

Externally verified on 2026-07-21:

| Endpoint                                                      | CORS                | Key  | Notes                                                                                                                                                                            |
| ------------------------------------------------------------- | ------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `learn.microsoft.com/api/catalog/?type=modules`               | `*`                 | none | 3,592 modules, ~6 MB JSON (≈1 MB gzipped). No free-text search — `q` is ignored. Fields: title, summary, url, uid, products, roles, levels, duration, popularity, last_modified. |
| `en.wikipedia.org/w/api.php` (`list=search`, `prop=extracts`) | `*` with `origin=*` | none | Real ranked search plus full plain-text page extracts, both browser-callable.                                                                                                    |
| `learn.microsoft.com/api/search`                              | none                | none | Ranked site search. Not CORS-open → companion-only, phase 2.                                                                                                                     |

Consequence: a genuinely useful research loop is possible **entirely in the hosted
browser app, with zero keys, zero accounts, and zero new dependencies**. That was not
obvious before checking, and it reorders the phases below.

## Approaches considered

**A. Browser-first with keyless CORS-open providers (recommended).**
Core gains a `research/` module (query planning, provider interface, deterministic
scoring, suggestion lifecycle). The app gains a Research panel. Two providers ship:
Microsoft Learn catalog and Wikipedia. Works on the hosted PWA for every user today.
Limits: no arbitrary-URL fetching, MS Learn ranking is local scoring over the catalog.

**B. Companion-first general research.**
Add `/api/research/fetch` (readability extraction, SSRF guards) and search-provider
proxies to the companion; the browser talks to it. Most general — any URL, key-based
providers, the ranked MS Learn search API — but the companion is not yet published to
npm, so this reaches almost nobody today, and it carries the largest security surface.

**C. Agentic pipeline (Ollama ranking, generated notes, scheduled research).**
Everything the spec lists as not-built-yet at once. Requires model ops, generated-content
marking, diff-before-replace UX. Lowest confidence, largest surface.

Decision: **A now, B as phase 2, C as phase 3.** A is the smallest thing that delivers
the second-brain loop, honors “the hosted app remains useful without installation”
(ADR-001), and is the strongest fit for the certification scenario. B and C plug into
the same provider interface later.

## Phase 1 design

### Architecture

```text
roadmap.md ─▶ learning loop ─▶ next objective
                                   │
                            research/plan.ts        (objective → query, deterministic)
                                   │
                            research/providers/     (mslearn.ts, wikipedia.ts)
                                   │  fetch injected, zod-parsed responses
                            research/score.ts       (deterministic ranking)
                                   │
                            research/suggest.ts     (dedupe vs manifest + dismissed)
                                   │
        ResearchPanel.svelte ──────┤ preview-first UI, disclosure gate
                                   │
              accept ─▶ sources/import.ts addSource ─▶ Sources/items + manifest
                                   │                      + Updates log + graph
              dismiss ─▶ Topics/<slug>/research.json
```

All research state flows through the existing storage adapters; nothing new touches
the network except the two provider calls, and only after per-provider consent.

### Core module (`packages/core/src/research/`)

```ts
export interface ResearchQuery {
  objectiveTitle: string; // cleaned of markdown/wikilink syntax
  topicTitle: string;
  terms: string[]; // lowercased, stopwords removed — used by scoring
}

export interface ResearchCandidate {
  key: string; // "mslearn:<uid>" | "wikipedia:<pageid>"
  provider: 'mslearn' | 'wikipedia';
  title: string;
  url: string;
  snippet: string; // plain text, sanitized before render
  score: number;
  meta: Record<string, string>; // duration, level, products… display-only
}

export interface ResearchCapture {
  title: string;
  url: string;
  content: string; // markdown written into the source file
}

export interface ResearchProvider {
  readonly id: 'mslearn' | 'wikipedia';
  readonly label: string;
  readonly disclosure: string; // exact egress sentence shown in the consent gate
  search(query: ResearchQuery, fetchImpl: typeof fetch): Promise<ResearchCandidate[]>;
  capture(candidate: ResearchCandidate, fetchImpl: typeof fetch): Promise<ResearchCapture>;
}
```

- `plan.ts` — `buildResearchQuery(topicTitle, objective)` produces `ResearchQuery`.
  Tokenization: NFKD-lowercase, strip punctuation, drop a fixed English stopword list.
- `score.ts` — `scoreCandidate(query, {title, summary, popularity})`: term hits in
  title weigh 3, in summary 1, `popularity` breaks ties (MS Learn only), then stable
  lexicographic order. Pure and fixture-tested; no network, no randomness.
- `providers/mslearn.ts` — fetches the module catalog once per session (module-level
  in-memory cache), scores locally, returns top 8. `capture` does **not** fetch the
  module page (not CORS-open): content is the catalog summary plus metadata, honestly
  labeled — this is an enriched URL reference, not a page snapshot.
- `providers/wikipedia.ts` — `list=search` for candidates (top 8);
  `capture` fetches `prop=extracts&explaintext` and stores the full plain-text
  extract (truncated with a marker if it would exceed the 2 MiB source cap).
- `suggest.ts` — filters candidates: drop any whose URL is already in the source
  manifest and any whose key is in `research.json` dismissals; exposes
  `dismissSuggestion` / `readDismissed`.
- Provider HTTP responses are parsed with lenient zod schemas (only the fields we
  use are required) so catalog drift degrades to a friendly error, not a crash.

### Data contract changes (all additive, `schemaVersion` stays 1)

1. **`SourceRecord.origin`** (optional):
   `{ provider: 'mslearn' | 'wikipedia'; capturedVia: 'catalog-reference' | 'api-extract'; capturedAt: ISO }`.
   Existing zod object schemas strip unknown keys, so v0.1.0 readers keep working.
   Known trade-off: if an old app version rewrites the manifest it drops `origin`
   metadata (content files are untouched). Accepted for a 0.x local-first product;
   a schema-version bump with migration remains available if this ever bites.
2. **`Topics/<slug>/research.json`** (new machine-owned file, created on first
   dismissal): `{ schemaVersion: 1, topicSlug, dismissed: [{ key, title, at }] }`.
   Hash-guarded writes like every other machine file. No run history — YAGNI until a
   history view exists.
3. Accepted sources keep `method: 'url'`. The manual-capture path and its “stored
   without fetching” stub are unchanged; research captures simply write richer
   content plus `origin`. The portable file contract doc gains the optional field.

### App surface (`ResearchPanel.svelte`, section of the topic view)

1. Objective selector, defaulting to the next unchecked objective.
2. One search action per provider. First use of a provider opens the disclosure gate:
   _“Searching sends this objective’s text to Microsoft Learn (learn.microsoft.com)
   over HTTPS. Nothing else from your workspace is sent. Allow on this device?”_
   Consent is per-provider, stored in `localStorage` (device preference, like theme).
3. Results list ordered by score: title, provider tag, snippet, metadata line;
   actions **Preview** and **Dismiss**. Fully keyboard operable, 44 px targets,
   focus returned to the invoking control when the preview closes.
4. Preview shows exactly what the source file will contain; **Add to sources** calls
   `addSource`; the silent-success rule applies (the new source is visible in the
   library and the update log).
5. Error and empty states follow design.md: adjacent to the action, naming the exact
   alternative (“Search needs a network connection. Paste text or add a URL
   reference from the source library instead.”).

Today view, roadmap, and graph are untouched — the graph picks up new source files
automatically.

### Security and trust

- Egress only after explicit per-provider consent; the disclosure names the host and
  exactly what is sent (objective title text). This implements the spec’s existing
  trust-model requirement.
- All provider text (snippets, summaries, extracts) is untrusted data: rendered
  through the existing sanitized Markdown path, never interpreted as instructions.
- No API keys, no accounts, no new persistent identifiers. Requests are plain HTTPS
  GETs. Personal data never enters query strings — queries are objective titles.
- The service worker must not cache cross-origin API responses (verify its fetch
  handler is same-origin scoped; if `app.html` sets a CSP, add the two hosts to
  `connect-src`).
- `addSource`’s size cap, hashing, and conflict protocol apply unchanged.

### Testing

- Unit (vitest, no network): query planning; scoring determinism and order; provider
  parsers against captured real fixtures; suggestion filtering against manifest and
  dismissals; `research.json` round-trip including hash-conflict; accept path via
  memory storage asserting manifest + update entry + file content.
- E2E (Playwright, `page.route` fixtures for both APIs): disclosure gate blocks the
  first search until consent; search → preview → accept produces a visible source
  and graph node; dismissed suggestion stays gone after reload; axe checks stay
  green on the panel.

### Docs to update in the implementing PR (not before)

`docs/product/spec.md` (move web search / limited source capture out of
“Explicitly not built yet”, describe the disclosure gate), README product table and
roadmap sentence, site docs page, CHANGELOG, ADR-003 file-contract appendix
(`origin`, `research.json`).

## Out of scope (phased, in order)

- **Phase 2 — companion research service:** `/api/research/fetch` with readability
  extraction and SSRF guards (private-IP and redirect filtering, content-type and
  size limits); proxy for the ranked MS Learn search API; “upgrade reference to full
  content” action on existing URL sources. Same provider interface.
- **Phase 3 — assisted relevance and synthesis:** key-based general web search
  (Brave/Tavily via companion env config), Ollama-backed re-ranking and draft notes
  through the existing `AIProvider` interface with generated-content marking, and
  any scheduled/unattended research.
- Non-goals at any phase: accounts, sync, telemetry, sending workspace content
  beyond the disclosed query text.

## Risks

| Risk                                                        | Mitigation                                                                                                 |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| MS Learn catalog has no server-side ranking                 | Local scoring over title+summary is adequate for objective-title queries; phase-2 proxy to the ranked API. |
| ~6 MB catalog fetch per session                             | Session memory cache; ~1 MB gzipped transfer; persistent OPFS cache only if real usage shows pain.         |
| Catalog/API shape drift (no versioning)                     | Lenient zod parsing, fixture tests, friendly failure UI.                                                   |
| Old app versions rewriting manifests drop `origin` metadata | Metadata-only loss, content files untouched; documented above.                                             |
| Provider text injection                                     | Same sanitization path as pasted sources; text is data, never instructions.                                |
