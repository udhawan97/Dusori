# Research agent (web-research Phase 3) — design

**Status:** approved · **Date:** 2026-07-21

## Program context

Phase 2 (companion research service), the scoped npm publication, and the
deterministic review queue/recap all shipped by v0.4.0. This spec designs the
next program item: the **research agent** — the expanded successor to the
"Phase 3 — assisted relevance and synthesis" sketch in
[2026-07-21-web-research-second-brain-design.md](2026-07-21-web-research-second-brain-design.md).
Later program items, in order: review-queue question generation from approved
sources, an additional curriculum importer, Reddit/YouTube providers.

Review-queue question generation shipped on 2026-07-27 as source-grounded
review sessions ([2026-07-27-source-grounded-review-design.md](2026-07-27-source-grounded-review-design.md)).

## Goal

From a roadmap objective, one user-triggered run queries every consented
provider (all free, free-tier, or open-source), merges and scores candidates
deterministically with visible reasons, and presents a type-diverse **top-5**
shortlist. Approving a candidate captures it as a source with provenance and —
when the companion is present — fetches its full readable text. A run can end
with a clearly marked **research brief** note: reading order, why each source
made the cut, gaps. Re-running an objective remembers what was seen and badges
genuinely new finds. Everything works without AI; a configured AI provider
(local Ollama or a cloud key held by the companion) upgrades ranking, adds a
one-line reliability note per candidate, and writes the prose brief.

## Decisions taken during brainstorming

- **Consent:** the existing per-provider pattern extends by data — each new
  provider ships its own `disclosure` (and `consentScope` where egress widens).
  Approving a candidate **is** the fetch consent for that URL (host shown in
  the approve preview). Runs are always user-triggered; no unattended egress.
- **Providers v1:** Hacker News (Algolia), GitHub, Stack Exchange, arXiv, plus
  Brave/Tavily/SearXNG general web search when configured in companion env.
  Reddit and YouTube are deferred (API friction, not value).
- **Vetting is layered:** deterministic scoring always runs (normalized
  community votes, recency, curated domain-reputation list, dedupe) with
  visible reasons; AI, when configured, re-ranks and annotates but **never
  hides** a candidate. Advisory, not gatekeeper.
- **AI plumbing:** all AI egress and credentials live in the **companion**
  (env/config on disk). The app never stores keys and shows AI affordances
  only when the companion reports a configured provider. Model-agnostic:
  Ollama URL + model name are configuration, not code.
- **Approval:** top-5 type-diverse shortlist, "show more" for the next
  tranche; approve = capture + auto-full-fetch (companion), stub fallback on
  fetch failure; dismissals feed the existing dedupe.
- **Tutor output:** one marked research-brief note per run; deterministic
  version without AI (grouped listing, no fake prose).
- **Freshness:** re-run with memory — seen keys and `lastRunAt` persist per
  topic; new finds get a NEW badge. No scheduling.
- **Sequencing:** one spec, three build phases; Phase B ships before C starts.

## Build phases

- **A — preparation refactors** (no behavior change): split the companion
  `createServer()` god-function into per-domain Fastify plugins (workspace,
  research, static/session); move candidate display metadata and
  `capturedVia` onto the provider so `ResearchPanel.svelte` loses its
  `provider === 'mslearn'` switches; delete the unused `AIProvider`
  placeholder in `core/src/adapters.ts` (zero consumers).
- **B — deterministic agent:** new providers, scoring, top-5 approval flow,
  run memory, deterministic brief. Fully useful with no key and no AI.
- **C — AI layer:** companion AI routes (Ollama/OpenAI/Anthropic), re-rank +
  reliability notes, generated brief. Honors ADR-007: the AI seam is designed
  against these first real consumers, not before.

## Providers

| Provider       | Transport                                     | Auth                   | Rating signal             | `capture()` content                                              |
| -------------- | --------------------------------------------- | ---------------------- | ------------------------- | ---------------------------------------------------------------- |
| Hacker News    | app-direct (Algolia API, CORS-open)           | none                   | points, comment count     | stub: title/url/snippet + signals; full text via companion fetch |
| GitHub         | app-direct (api.github.com, CORS-open)        | none (60/hr)           | stars, recency of pushes  | README markdown via API                                          |
| Stack Exchange | app-direct (api.stackexchange.com, CORS-open) | none (IP quota)        | votes, accepted answer    | top answer body, sanitized                                       |
| arXiv          | companion proxy (no CORS upstream)            | none                   | recency, category match   | abstract + links                                                 |
| Web search     | companion proxy                               | env key or SearXNG URL | none (vetting layer only) | stub; full text via companion fetch                              |

App-direct providers follow the Phase 1 Wikipedia/MS Learn precedent (injected
`fetch`, zod-parsed, works on the keyless hosted app). CORS assumptions are
verified by a spike at the start of Phase B; any provider that fails in
practice moves behind the companion proxy, UI unchanged.

The web-search upstream is one of `brave | tavily | searxng`, selected by env
(`RESEARCH_WEB_SEARCH=brave` + `BRAVE_API_KEY`, etc.; SearXNG needs only
`SEARXNG_URL`, keeping a fully open-source, keyless path available).

## Core module design

Follows the Phase 1 provider pattern throughout: network through injected
`fetch`, responses zod-parsed in core, storage through the adapter interface.

- **`research/types.ts`** — `ResearchProviderId` widens from the two-value
  union to `string` (same tolerant-widening move Phase 2 made for
  `origin.provider`). `ResearchCandidate` gains optional `kind`
  (`article | repo | paper | qa | docs`), `publishedAt`, `communityScore`,
  and `signals: string[]` (human-readable score reasons). `ResearchProvider`
  gains `capturedVia` and a `describeMeta(candidate)` display hook so a new
  provider is add-file-plus-register with no panel edits.
- **`research/providers/*.ts`** — one file per provider above, registered in
  the existing `providers/index.ts` array.
- **`research/score.ts`** — deterministic scoring: per-provider log-normalized
  community score, recency decay, curated domain-reputation constant (official
  docs, .edu, known references boosted; known content farms penalized),
  existing key/URL dedupe, then greedy type-diverse top-5 selection. Pure
  functions, golden-tested; every component contributes a visible reason.
- **`research/agent.ts`** — the run orchestrator: fan out to consented
  providers with a per-provider timeout, merge partial results (a failed
  provider yields a visible "skipped" note, never a failed run), score,
  select, and annotate NEW against run memory.
- **`research/research-file.ts`** — `research.json` gains optional
  `lastRunAt` and `seen: [{ key, url?, at }]` alongside `dismissed`.
  Additive fields; existing readers strip unknown keys, so no version bump.
- **`research/brief.ts`** — builds the brief note body. Deterministic mode:
  approved sources grouped by kind with signals and links. AI mode: prose
  reading order/rationale/gaps, generated via the companion.
- **AI seam (Phase C, replaces the deleted placeholder):**
  `research/ai.ts` defines
  `rerank(candidates, query) → { key, aiScore, note }[]` and
  `writeBrief(approved, query) → string`, implemented by a
  `CompanionAiClient` (baseUrl/token/fetchImpl, like
  `CompanionResearchClient`). AI failures fall back silently to the
  deterministic order, with a visible "AI unavailable" note.

## Companion API design

All new routes sit behind the existing per-launch bearer token, origin
allowlist, and loopback-only listener (ADR-004), registered via the Phase A
plugin seam.

- **`GET /api/research/web-search?q=`** — proxies only the configured
  upstream (hardcoded URL per upstream kind, query attached); lenient zod;
  top 8 `{ title, url, summary, publishedAt? }`. `503 { reason:
'not-configured' }` when no upstream is set.
- **`GET /api/research/arxiv?q=`** — fixed upstream `export.arxiv.org` Atom
  API; parsed to the same candidate shape.
- **`GET /api/ai/capabilities`** — `{ providers: [{ id, model }] }` derived
  from env; the app's only signal to show AI affordances.
- **`POST /api/ai/rerank`** — body `{ query, candidates: [{ key, title,
snippet, url, kind }] }`; returns scores + one-line notes. Candidate
  metadata and query text are the **only** workspace-derived data sent.
- **`POST /api/ai/brief`** — body `{ query, sources: [{ title, url, kind,
signals }] }`; returns Markdown.

Env configuration: `OLLAMA_URL`/`OLLAMA_MODEL`,
`OPENAI_API_KEY`/`OPENAI_MODEL`, `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`,
`RESEARCH_WEB_SEARCH` + upstream key/URL. Precedence when several are set:
explicit `AI_PROVIDER` env, else first configured of ollama → anthropic →
openai (local-first default). Exact cloud model defaults are pinned during
Phase C implementation, documented in companion `--help` and site docs.

## Data contract (`schemaVersion` stays 1)

- `research.json`: additive optional `lastRunAt`, `seen[]`.
- `origin.provider` already tolerates new provider ids (Phase 2 widening);
  new values arrive with their natural `capturedVia` labels per provider.
- The brief lands as a normal topic note with frontmatter
  `generated: research-brief` and a visible first line naming the generator
  ("Generated by the research agent — sources chosen by you."). AI-written
  briefs additionally name the model. Preview-first; dismissing stores
  nothing.

## App surface

Everything lives in the existing Research panel, per objective:

1. **Provider consents** render from the registry (data-driven, zero new
   cards): each unconsented provider shows its disclosure; web-search and AI
   scopes appear only when the companion reports them available.
2. **Run** produces the top-5 shortlist: kind badge, title, snippet, signals
   line ("312 HN points · 2025 · official docs"), NEW badge, AI note when
   present. "Show more" reveals the next tranche. Dismiss works per candidate.
3. **Approve** opens the existing preview-first flow naming exactly what will
   be written and, when the companion will fetch full text, the exact host.
   Confirm captures via the existing `addSource` funnel (+`upgradeSource`
   full-text path); a failed fetch captures the stub and says so inline.
4. **Brief** is offered after at least one approval — preview, then saved as
   a note; deterministic version when no AI is configured.
5. **Without the companion:** app-direct providers still run; arXiv,
   web search, full-text upgrade, and AI affordances are absent, with the
   existing one-line hint ("Run the companion for full-page content, web
   search, and AI ranking.").

## Security and trust

- Loopback bind, bearer token, origin allowlist, SSRF pipeline, size caps,
  and sanitized-Markdown rendering all unchanged and reused (ADR-004,
  Phase 2 spec). Proxy routes are hardcoded to their single upstream.
- Keys exist only in the companion process env; never logged, never returned
  by any endpoint (`/api/ai/capabilities` reports provider ids and model
  names only), never stored in the browser.
- AI and search egress is limited to candidate metadata and the disclosed
  query text — never note contents — and each scope's consent card says so.
- Provider text (snippets, READMEs, answers, AI notes) is untrusted data:
  sanitized rendering, never interpreted as instructions.
- The domain-reputation list is editorial: it only reorders, never filters,
  and its effect is always visible in the signals line.

## Testing

- **Phase A:** existing companion suite passes unchanged after the plugin
  split (auth/origin gates re-asserted per plugin); panel snapshot proves
  provider-neutral rendering.
- **Phase B (core):** per-provider fixture tests (response → candidates →
  capture); scoring golden tests (normalization, recency, diversity
  selection, reason strings); run-memory round-trip (seen/NEW/dismissed
  interplay); merge-with-partial-failure.
- **Phase B (e2e, `page.route` fixtures):** consent gates per provider;
  run → shortlist → approve → source visible with provenance; NEW badge on
  re-run; brief preview → note exists; axe green on new cards and dialogs.
- **Phase C:** companion AI routes with injected upstream fakes (capability
  detection, rerank parse, error → silent deterministic fallback); e2e with
  AI fixtures for notes and generated brief marking.

## Docs to update in the implementing PRs (not before)

README roadmap sentence and product table (Research row); `docs/product/spec.md`
phase status; ADR-004 note (companion scope gains search proxy and AI routes);
ADR-007 note (first AI vertical slice, seam shape); site docs; CHANGELOG;
companion `--help`/env reference. Optional: seed `CONTEXT.md` with the research
vocabulary (candidate, capture, signals, run, brief, scope).

## Out of scope

- Reddit and YouTube providers; any scheduled or unattended research.
- Review-queue question generation from sources (next program item).
- Chat-style tutoring UI; AI transforms of workspace notes.
- Key entry in the app; hosted-app AI of any kind.
- Accounts, sync, telemetry — non-goals at every phase.

## Risks

| Risk                                                        | Mitigation                                                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Keyless API rate limits (GitHub search 10/min, SE IP quota) | One query per provider per run; per-provider timeout; partial results with visible "skipped" note.                       |
| CORS assumptions wrong for an app-direct provider           | Phase B spike verifies each; fallback is the companion proxy behind the same provider interface.                         |
| Upstream shape drift (five new APIs)                        | Lenient zod, fixtures per provider, silent per-provider skip with visible note — a run never hard-fails on one provider. |
| Curated domain list embeds editorial bias                   | Small, visible in signals, reorder-only; the user's approval step stays the final judgment.                              |
| AI vetting quality varies by model                          | Advisory-only: AI never hides candidates; deterministic score and signals always shown alongside.                        |
| Free-tier web-search quota exhaustion                       | Companion surfaces the quota error verbatim; keyless providers keep the run useful; SearXNG path has no quota.           |
| Brief reads as authority it doesn't have                    | Marked generated, names its generator/model, cites only user-approved sources, preview-first.                            |
| `research.json` growth over many runs                       | `seen` capped (drop-oldest) well above any real usage; dismissals untouched.                                             |
