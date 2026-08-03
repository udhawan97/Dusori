# Research-first missions — design

**Status:** approved · **Date:** 2026-08-02 · **Target:** v0.10.0+

## Goal

Dusori becomes a research-first personal intelligence assistant. A user names a topic they
want to understand; Dusori researches allowed providers, shows its work as an inspectable
mission with a durable trail, deep-reads approved sources into verbatim claims, synthesizes
a living topic document, and can generate an optional interactive HTML learning page — all
with a transparent path from every statement back to its evidence.

The promise: _"Tell Dusori what you want to understand. It finds, evaluates, organizes, and
teaches the best available information, with a transparent trail back to the evidence."_

## Decisions (settled 2026-08-02)

| Decision         | Choice                                                                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| First user       | Curious generalist typing any topic; certification learners keep working                                                                           |
| Depth vs speed   | Fast scan first (~10 s), explicit one-click deep pass after                                                                                        |
| Source reach     | Companion-first; hosted browser app degrades honestly to its 7 keyless providers                                                                   |
| Refresh autonomy | Per-topic standing toggle; on-open re-scan when stale; no closed-app work                                                                          |
| AI reliance      | AI writes prose over a deterministic structure; no-AI path stays genuinely useful                                                                  |
| Learn mode       | Portable self-contained HTML file, rendered in a locked sandbox iframe                                                                             |
| Architecture     | Persist-first evolution: extend `research.json` + `SourceRecord` additively; mission status is derived from evidence, never a stored state machine |

## Background — what exists (verified in code and rendered app)

- `runResearchAgent` (`packages/core/src/research/agent.ts`) already fans out over consented
  providers in parallel, reports failures as `skipped[]` distinct from empty results, ranks
  deterministically with human-readable `reasons`, and picks a kind-diverse top five.
- Eleven providers behind per-provider egress consent; companion adds page fetch (SSRF-guarded),
  arXiv, Reddit, YouTube, web search (Brave/Tavily/SearXNG), and advisory AI.
- `research.json` persists only `dismissed[]`, `seen[]`, `lastRunAt`. **Run results, skips,
  ranking reasons, and bibliographic metadata are computed, displayed, then thrown away** —
  `agent.ts:99` records nothing on total failure; `addSource` drops `publishedAt` and `reasons`.
- Rendered-app findings (desktop + 375×812): shortlist vanishes on reload; Today shows no
  research state; live relevance bug — topic "Spaced repetition learning" with template
  objective "Establish the terms and boundaries" surfaced "Go (game)" and "Glossary of
  computer science" and missed the "Spaced repetition" article; Continue-learning card
  actions overlap its text at ~1200 px with the inspector drawer open.

## Inspiration (adopted patterns)

- **GPT Researcher** (~28k★): visible Plan → Search → Read → Reflect → Iterate → Synthesize
  loop; open questions feed the next iteration. Adopted as the mission trail + refresh loop.
- **Stanford STORM**: perspective-guided question asking; outline-first cited synthesis.
  Adopted as deterministic research angles and the synthesis document shape.
- **Perplexica** (~33k★): focus modes over SearXNG. Adopted as per-mission lens coverage
  (Docs · Academic · Community · Video · Web) for both control and honest gap reporting.

## Design

### 1. Missions are derived, not stored

A mission is the evidence-backed research life of one topic. Its status is always computed
from `research.json` + `Sources/manifest.json` + synthesis presence — the same rule Today
already follows ("items disappear only when their underlying workspace evidence changes").
No mission state machine exists to drift or lie.

### 2. Data contracts (all additive-optional; `schemaVersion` stays 1)

`Topics/<slug>/research.json` gains:

```ts
runs?: Array<{
  at: string;                       // ISO
  searchText: string;               // exactly what providers received
  angleId?: string;                 // which research angle seeded it
  providers: Array<{
    id: string; label: string;
    outcome: 'found' | 'empty' | 'failed';
    count: number;                  // candidates returned (0 for empty/failed)
    message?: string;               // the skip/failure text shown at run time
  }>;
  newKeys: number;                  // candidates not in seen[] at run start
}>;                                 // bounded: last 50 runs, oldest dropped
openQuestions?: Array<{ text: string; at: string;
  status: 'open' | 'resolved'; origin: 'synthesis' | 'user' }>;  // bounded 20
autoRefresh?: boolean;              // standing on-open re-scan consent for this topic
```

`SourceRecord` (in `Sources/manifest.json`) gains:

```ts
publishedAt?: string;               // ISO date the artifact was published
publisher?: string;                 // site/platform name, e.g. "Wikipedia", "arXiv"
author?: string;                    // byline or channel when a provider reports one
whySelected?: string[];             // the ranker's reasons, verbatim at accept time
readState?: 'reference' | 'readable' | 'read';
claims?: Array<{ text: string; heading?: string; at: string }>; // verbatim excerpts, ≤12
```

Claims are always verbatim quotes from the stored local text with their section heading —
AI never writes or rewrites a claim. A total-failure run (every provider failed) **is
recorded** in `runs[]`; today it leaves no trace.

New writer functions follow `recordResearchRun`'s idiom exactly: `readMachineFile`,
read-modify-write with `expectedHash`, 3× retry on `StorageConflictError`, bounded arrays.

### 3. Research angles replace template objectives as query seeds

Deterministic derivation from the topic title (STORM's perspectives, no AI required):

| id          | title                 | searchText suffix       |
| ----------- | --------------------- | ----------------------- |
| `overview`  | Definition and scope  | _(topic alone)_         |
| `mechanism` | How it works          | `how it works`          |
| `debate`    | Debates and criticism | `criticism limitations` |
| `practice`  | Practice and tools    | `guide tools practice`  |
| `recent`    | Recent developments   | `recent developments`   |

Angles are derived at runtime from the topic title — never stored, so there is no second
source of truth; `runs[].angleId` plus the verbatim `searchText` reconstruct any past run.
The Research view offers angles as chips; the default scan uses `overview`. Roadmap
objectives remain selectable for certification learners — angles and objectives are two
sources of the same `ResearchQuery`.

**Relevance fix:** `ResearchQuery` separates `topicTerms` from `angleTerms`. Scoring keeps
today's weights for topic terms, counts angle terms at half weight, and adds a phrase bonus
when consecutive topic words appear in the title. The rank explanation strings keep working
unchanged. This kills the "Establish the terms and boundaries" pollution class of failure.

### 4. Scan → deep pass → refresh

- **Scan** (existing agent): after ranking, persist the run record at the exact point
  results are discarded today (`agent.ts:99`) — including all-failed runs.
- **Deep pass** (explicit "Read these" on selected/accepted sources): with the companion,
  `fetchPage` upgrades any URL source to readable text via the existing SSRF-guarded,
  conflict-safe `upgradeSource`; without it, the six browser-reachable text providers
  (Wikipedia, OpenAlex, GitHub, Stack Exchange, Hacker News, npm) still yield local text and
  the UI names exactly what the companion would add. After text lands, deterministic
  heading-aware extraction (reusing `recall.ts` sectioning) stores ≤12 claim excerpts and
  sets `readState: 'read'`.
- **Refresh**: explicit re-scan per angle, or automatic on app open when `autoRefresh` is
  on, `lastRunAt` is older than 7 days, and ≥1 provider is already consented — at most once
  per topic per app session. New-since-last candidates keep the existing `isNew` badge;
  accepted sources are never modified by a refresh. No closed-app work, ever.

### 5. Surfaces

- **Today** opens with a **Missions** section above the existing lanes: one strip per
  active topic — sources discovered / saved / read counts, last-refreshed age, five lens
  dots (filled / empty / unavailable-with-reason), up to two open questions, and the one
  evidence-derived next action (Continue reading · Refresh · Review · Start research).
  Unavailable lenses state their cause honestly ("Community — Reddit not configured").
  Lens membership is a fixed map in core over provider ids: Docs = mslearn, wikipedia,
  github, npm · Academic = openalex, arxiv · Community = hackernews, stackexchange, reddit ·
  Video = youtube · Web = websearch.
- **Research view** adds the **trail**: reverse-chronological runs, each expandable to its
  per-provider outcomes with counts and failure messages, plus the angle chips and the
  existing shortlist. A returning user sees what happened without re-running anything.
- **Graph/Insights**: synthesis and learning artifacts appear as new node kinds; Insights
  gains mission coverage (read ratio, lens spread, staleness).
- The ~1200 px inspector-open overlap on Today's Continue-learning card is fixed in
  phase 1 (grid min-width, not absolute positioning).

### 6. Synthesis document

`Topics/<slug>/Synthesis.md`, `generated: synthesis` frontmatter, regenerated only on
explicit click, written through `proposeMarkdownUpdate` so a user-edited synthesis is never
clobbered — regeneration over local edits produces the standard sibling proposal + diff.

Deterministic structure (always available):

```
# Synthesis — <topic>
<generated-by line: date, N sources, M read deeply, model name if AI prose>
## What matters            — claims ordered by cross-source support
## Key concepts            — claims clustered by shared heading/terms, each cited [[source-item]]
## Agreements and tensions — claim clusters from ≥2 sources; single-source flagged "thin evidence"
## Timeline                — only when ≥3 sources carry publishedAt
## Open questions          — written back to research.json, seeds the next refresh
## Evidence table          — source · lens · published · read state · why selected
```

With companion AI consented (existing `companion-ai` scope): a new `/api/ai/synthesize`
endpoint (same capped-body → `complete()` → `extractJsonObject` → zod pattern; ≤60 claims
in) returns prose for _What matters_ and _Agreements and tensions_ plus suggested open
questions. AI prose is labeled with its model inline; the deterministic sections and the
evidence table are never AI-written. AI failure keeps the deterministic document.

### 7. Learn mode

An explicit "Create learning page" on topics with ≥1 read source generates
`Topics/<slug>/Learning/learn.html` — fully self-contained (inline CSS/JS, embedded JSON
payload, zero external requests), responsive, and portable. Content: progressive concept
sections from the synthesis clusters, claim cards linking both the original URL and the
local source file, a timeline when dates exist, and check-yourself prompts reusing the
recall templates (reveal-style, no scoring, no storage). AI, when consented, rewrites the
narrative layer only; every claim keeps its citation.

Rendering: in-app via `<iframe sandbox="allow-scripts" srcdoc={…}>` — never
`allow-same-origin` — following the MermaidFrame precedent; CSP already allows it. The file
is machine-owned like JSON (regenerate-on-click with preview; an externally edited file is
detected by hash and regeneration then writes `learn.proposed-<ts>.html` beside it rather
than overwriting). `portable.ts` export/import and the graph learn the `Learning/` folder.

### 8. Trust and failure model

- A provider failure is never presented or stored as "no research found" — outcomes are
  per-provider, per-run, durable, and visible.
- Every claim is a verbatim quote with source path, heading, and retrieval time.
- Synthesis marks thin evidence, disagreement, and staleness instead of flattening.
- Generated artifacts self-declare (`generated:` frontmatter, model names, generated-by
  lines); user Markdown is never machine-edited without the proposal protocol.
- Copyright/ToS posture unchanged: store extracted text bounded at 2 MiB with provenance,
  link back to originals, respect per-provider consent and companion SSRF/rate limits.

### 9. Capabilities that free public sources cannot reliably deliver

Named honestly in-product where they bite: general web search needs an operator-configured
SearXNG instance or a Brave/Tavily key; Reddit needs an operator-registered app credential;
YouTube needs an Invidious instance; arbitrary-URL deep reading needs the local companion;
AI prose needs Ollama (free, local) or an API key. The npm-published companion is still
v0.4.0 (publish pipeline broken) — README/site language stays truthful about `npx` reach.

## Testing and migration

- **Unit (vitest, no network):** run-ledger round-trip, bounds, and conflict retry; angle
  derivation; topic/angle-term scoring incl. the phrase bonus (fixture-locked against the
  observed "Go (game)" failure); claim extraction over headed and headless Markdown; lens
  mapping totality (every registered provider belongs to exactly one lens); deterministic
  synthesis snapshot; learn-HTML generator self-containment (no `http(s)://` references
  outside claim links, which must also appear in the embedded JSON payload); companion
  `/api/ai/synthesize` body caps and zod rejection.
- **E2E (Playwright, `page.route` fixtures):** scan → reload → trail shows per-provider
  outcomes; all-providers-failed run persists and renders as failure, distinct from a real
  empty result; deep pass with mocked companion produces claims and `readState: 'read'`;
  synthesis regen over a user-edited file produces a sibling proposal with diff; learn page
  renders inside the sandboxed iframe and its check-yourself prompts work; axe checks and
  375×812 layout on Today's mission strip and the Research trail.
- **Migration:** none required — every new field is optional, old workspaces open
  unchanged, and older readers that rewrite manifests drop only the new optional metadata
  (accepted ADR-003 trade-off). `portable.ts` import validation and export learn
  `Learning/` and the new optional fields; export/import round-trip is e2e-locked.

## Phases (each independently shippable)

1. **Mission trail persistence + surface** — persist `runs[]` (incl. failures) and
   `whySelected`/`publishedAt`/`publisher`/`author`; Research trail UI; Today mission strip
   (counts, freshness, lens dots, next action); inspector-overlap bug fix.
   _Acceptance:_ run → reload → trail visible with per-provider outcomes; an all-failed run
   shows as failure after reload; axe + 375×812 pass.
2. **Generalist missions** — angles + relevance fix (`topicTerms`/`angleTerms`, phrase
   bonus); multi-select accept; `readState`; refresh diff + on-open auto-refresh toggle.
   _Acceptance:_ "Spaced repetition learning" scan surfaces the topic's own article first
   (fixture-locked); stale auto-refresh runs once and badges what's new.
3. **Deep pass** — browser-reachable text + companion fetch into `upgradeSource`; claim
   extraction; evidence table UI. _Acceptance:_ read source shows claims with headings;
   no-companion path names its boundary; conflict-safe on concurrent edit.
4. **Synthesis** — deterministic `Synthesis.md` + `/api/ai/synthesize` prose upgrade +
   open questions loop. _Acceptance:_ deterministic doc cites every claim; regen over
   user edit yields proposal; AI failure keeps deterministic output (fixture).
5. **Learn mode** — HTML generator + sandboxed render + export/graph integration.
   _Acceptance:_ generated file has zero external references (asserted by test), renders
   sandboxed, survives export/import round-trip.
6. **Docs and site sync** — README, product spec, site pages, CHANGELOG; graphify update
   gate before any release/tag.

## Out of scope

Closed-app/background refresh, OCR, accounts/sync/telemetry, inline video playback,
free-form chat editing workspace files, importing a single-topic bundle, un-consented
egress of any kind.

## Risks

| Risk                                                          | Mitigation                                                                                                              |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Deterministic claim extraction reads as shallow               | Verbatim quotes with location are honest by construction; AI prose layers on top; copy states what it is                |
| `runs[]`/`claims[]` bloat portable files                      | Hard bounds (50 runs, 12 claims/source, 20 questions) with oldest-first drop, mirroring `seen[]`                        |
| Angle queries still misrank on some topics                    | Phrase bonus + halved angle-term weight, fixture-locked ranking tests, reasons stay visible so failures are inspectable |
| Sandbox iframe scripting regressions                          | `allow-scripts` without `allow-same-origin` only; self-containment asserted by unit test; ADR records the decision      |
| On-open refresh surprises users                               | Off by default, per-topic toggle, runs only with existing consents, ≤1/topic/session, badge names what changed          |
| Old app versions rewriting manifests drop new optional fields | Same accepted trade-off as `origin` (ADR-003); content files untouched                                                  |
