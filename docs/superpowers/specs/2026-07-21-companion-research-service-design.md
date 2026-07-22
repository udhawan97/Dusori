# Companion research service (web-research Phase 2) — design

**Status:** approved · **Date:** 2026-07-21

> **Distribution outcome (v0.4.0):** npm rejected the unscoped `dusori` name as too similar to an existing package. The shipped package is `@udhawan97/dusori`; unscoped commands below preserve the original design record.

## Program context

Agreed feature sequence, each with its own spec → plan → implementation cycle:

1. **Phase 2 companion research service (this spec).**
2. Publish the companion to npm as `dusori` (so the first published `npx dusori`
   already contains the research service).
3. Deterministic schedules/recap in the learning loop.
4. An additional curriculum importer.

## Goal

Give the companion the research powers the browser cannot have: fetch an arbitrary,
user-chosen URL and turn it into readable text, and reach the ranked (non-CORS-open)
Microsoft Learn search API. Surface both in the app as the smallest possible UX:
an **upgrade to full content** action on existing URL-reference sources, and better
MS Learn ranking behind the existing Research panel. Everything else — consent
philosophy, source portability, conflict-safe writes, sanitization — stays exactly
as Phase 1 shipped it.

This implements the "Phase 2 — companion research service" section of
[2026-07-21-web-research-second-brain-design.md](2026-07-21-web-research-second-brain-design.md).

## Decisions taken during brainstorming

- **Scope:** full Phase 2 as originally phased — fetch endpoint with SSRF guards,
  MS Learn ranked-search proxy, and the upgrade-source action. The three share the
  companion HTTP plumbing and were designed together.
- **Consent for arbitrary fetching:** a **per-fetch confirm** naming the exact host.
  No stored allowlist: the explicit click on a visible URL is the consent, and
  fetches are rare. The MS Learn proxy reuses the existing per-provider `mslearn`
  consent (same host, same disclosed egress).
- **Where features light up:** only when the app was **served by the companion**
  (per-launch token already present). The hosted app shows a hint instead. No
  discovery or token-entry UI; `npx dusori` (next sub-project) is the distribution
  story.
- **Where extraction runs:** in the **companion** (approach 1 below).

## Approaches considered

**A. Companion-side extraction (chosen).** The companion fetches, guards, and
extracts; the app receives clean text only. Raw untrusted HTML never enters the
PWA, dependency weight lands in the opt-in Node process, and Phase 3's
scheduled/unattended research needs server-side extraction anyway.

**B. Dumb byte proxy, browser-side extraction.** Uses the browser's native
`DOMParser`, no Node DOM shim — but raw HTML crosses into the app, the readability
bundle ships to every PWA user (~100 KB, almost none of whom run a companion), and
extraction would have to move companion-side for Phase 3 regardless.

**C. Tag-strip only, no readability.** Zero new dependencies but noisy captures;
content quality is the point of the feature.

## Companion API design

Both endpoints sit behind the existing per-launch bearer token and origin
allowlist, on the loopback-only listener (ADR-004). ADR-004's "minimal file
operations only" milestone is superseded by this spec; the ADR gains a note.

### `POST /api/research/fetch` — body `{ url: string }`

Pipeline, in order:

1. **URL validation:** `http:`/`https:` schemes only.
2. **Address validation:** resolve DNS; reject loopback, RFC-1918, link-local,
   CGNAT (`100.64/10`), IPv6 `::1`, `fc00::/7`, `fe80::/10`, and IPv4-mapped
   equivalents. Validation runs against **every** address the lookup returns.
3. **Fetch:** manual redirect handling, maximum 3 hops, steps 1–2 re-run on every
   hop. ~15 s total timeout.
4. **Response guards:** `Content-Type` must be `text/html`,
   `application/xhtml+xml`, or `text/plain`; body streamed with a hard 4 MiB cap
   (abort past the cap, not truncate-and-pretend).
5. **Extraction:** `linkedom` DOM → `@mozilla/readability`. Plain-text output
   (`textContent`), matching the honest plain-text precedent of the Wikipedia
   extract. `text/plain` responses skip extraction.
6. **Truncation:** text longer than the 2 MiB source cap is truncated with the
   same visible marker convention Phase 1 uses.

Success: `{ title, text, byline?, siteName?, finalUrl, fetchedAt, truncated }`.
Errors are structured `{ error, reason }` with reasons
`invalid-url | blocked-host | too-many-redirects | timeout | unsupported-type |
too-large | fetch-failed | extraction-failed`, so the app can name the exact
problem and alternative.

### `GET /api/research/mslearn-search?q=<query>`

Proxies **only** the fixed upstream `https://learn.microsoft.com/api/search`
(locale `en-us`) — a hardcoded URL with the query string attached, never a general
proxy. The response is parsed with a lenient zod schema (only used fields
required) and trimmed to the top 8 `{ title, url, summary }` results.

### New companion dependencies

`@mozilla/readability` and `linkedom`, production dependencies of
`packages/companion` only. Neither enters the app bundle.

## Core module design (`@dusori/core`)

Follows the Phase 1 provider pattern: network through an injected `fetch`,
responses zod-parsed in core, storage through the adapter interface.

- **`research/companion.ts`** — `CompanionResearchClient`, constructed with
  `{ baseUrl, token, fetchImpl }`:
  - `fetchPage(url): Promise<FetchedPage>` — calls `/api/research/fetch`,
    zod-parses, maps error reasons to typed errors.
  - `searchMsLearnRanked(query): Promise<ResearchCandidate[]>` — calls the proxy,
    maps results into the existing `ResearchCandidate` shape; `key` stays
    `"mslearn:<uid>"` when the ranked API returns a uid, else the result URL is
    used so dedupe against the manifest and dismissals keeps working.
- **`sources/upgrade.ts`** — `upgradeSource(adapter, topicSlug, sourceId, page)`:
  - builds the replacement Markdown content: provenance header (final URL, fetched
    timestamp, byline/site when present) + extracted text — the same document
    shape as Phase 1 research captures;
  - rewrites the source item file hash-guarded against the manifest's recorded
    hash (external edit → existing `StorageConflictError` conflict path);
  - updates the manifest record: `origin` becomes
    `{ provider: 'companion', capturedVia: 'page-extract', capturedAt }`,
    `size`/`fetchedAt` refreshed, `mediaType` set to `'text/markdown'`; `sha256`
    stays the URL hash unchanged — for `method: 'url'` records it is the dedupe
    key and file-name stem, not a content hash; `method` stays `'url'`;
  - appends an update-log entry ("Upgraded source _title_ to full page content").
- **`research/providers/mslearn.ts`** — `createMsLearnProvider({ ranked? })`.
  When the app supplies a `ranked` search function (companion present), the
  provider uses it and **silently falls back** to the local catalog scoring on any
  error. Outward `ResearchProvider` interface unchanged; consent and disclosure
  unchanged.

## Data contract (`schemaVersion` stays 1)

- `SourceOriginSchema.provider` gains `'companion'`; `capturedVia` gains
  `'page-extract'`.
- Both fields **widen from strict enums to tolerant strings** (validated as
  non-empty strings; known values documented). This makes this release the last
  one where a new provenance value can break a reader.
- **Known compatibility cost:** the shipped v0.2.0 schema validates
  `origin.provider` as a strict two-value enum, so a stale v0.2.0 reader that
  opens a workspace containing an upgraded source fails its schema check and
  renames the manifest to `Sources/manifest.json.invalid-<timestamp>`. This does
  **not** self-heal: nothing restores the file, so even an updated app then
  reports the manifest as missing, and that topic's source library and ZIP export
  stay broken until the user renames it back by hand. Accepted for a 0.x
  local-first product because source content files are never touched — no
  material is lost — and the failure is loud rather than silent. The realistic
  trigger is a stale `npx dusori` companion serving its own bundled v0.2.0 app
  copy at the same workspace root. Documented in ADR-003's appendix alongside the
  existing `origin` metadata-loss note.

## App surface

All of it conditional on the companion token (present only when the companion
served the app):

1. **Upgrade action.** URL-reference sources in the source library show
   **Fetch full content**. Flow: click → per-fetch confirm naming the exact host
   ("Sends this address to `docs.python.org` from your machine via the local
   companion. The page's readable text will replace this source's stub content.")
   → fetch with progress state → **preview-first modal** showing exactly the
   content that will be written → **Replace content** commits via
   `upgradeSource`; the change is visible in the library and the update log.
   Dismissing the preview stores nothing.
2. **Ranked search.** The Research panel's MS Learn search transparently uses the
   ranked proxy under the existing `mslearn` consent — same host, same disclosed
   egress (objective title text), nothing new sent. Fallback to catalog scoring
   is silent.
3. **Without the companion:** the button is absent; the source detail shows one
   hint line — "Run the companion (`npx dusori`) to fetch full page content."
4. **Errors** render adjacent to the action and name the exact alternative
   (design.md rule), e.g. blocked private host → "This address points at a
   private network and won't be fetched. Paste the text instead."

Today, roadmap, and graph views are untouched; the graph picks up rewritten
source files automatically.

## Security and trust

- Loopback bind, per-launch bearer token, and exact origin allowlist unchanged
  (ADR-004).
- SSRF policy as specified above; the proxy endpoint is hardcoded to one upstream.
- Extracted text is untrusted data: rendered only through the existing sanitized
  Markdown path, never interpreted as instructions (same rule as every provider).
- Per-fetch confirm implements the spec's egress-disclosure requirement for
  arbitrary hosts; no consent state is stored for fetches.
- No new persistent identifiers, no keys, no logging of fetched URLs (companion
  logger stays disabled).
- **Residual risk:** time-of-check/time-of-use DNS rebinding between validation
  and connect is not fully pinned. Attacker model is a URL the user explicitly
  chose, on a loopback-bound, token-gated personal tool; per-hop re-validation is
  the proportionate guard. Recorded in Risks.

## Testing

- **Companion (vitest, extends `server.test.ts`):** table-driven address
  validator (private v4/v6 ranges, mapped addresses, multi-address lookups);
  fetch handler with injected upstream — happy path, size-cap abort, unsupported
  content type, redirect-to-private blocked, redirect limit, timeout; readability
  fixture page → stable extracted text; proxy response fixture → trimmed parsed
  results; auth/origin gates cover the new routes.
- **Core (vitest, memory adapter):** `CompanionResearchClient` parsing and error
  mapping against fixtures; `upgradeSource` round-trip — content replaced,
  manifest origin/hash updated, update log appended, stale-hash conflict raises
  `StorageConflictError`; widened origin schema accepts unknown provider strings;
  ranked-path fallback on proxy error.
- **E2E (Playwright, `page.route` fixtures for companion endpoints):** confirm
  gate blocks the fetch until confirmed; fetch → preview → replace produces
  visible upgraded content and an update entry; button absent without a companion
  token; axe checks stay green on the new dialog and modal.

## Docs to update in the implementing PR (not before)

README roadmap sentence and product table; `docs/product/spec.md` phase status;
ADR-003 appendix (widened `origin`, `page-extract`); ADR-004 note (companion
scope now includes the research service); site docs page; CHANGELOG.

## Out of scope

- npm publication of the companion (next sub-project).
- Key-based general web search, Ollama re-ranking, generated notes, scheduled or
  unattended research (Phase 3).
- Hosted-app → companion connect UI (token entry); revisit if users ask.
- Accounts, sync, telemetry — non-goals at every phase.

## Risks

| Risk                                              | Mitigation                                                                                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| SSRF via redirects or multi-address DNS           | Scheme check, per-hop re-validation of every resolved address, redirect cap, private-range rejection, tests.                                   |
| DNS rebinding between check and connect           | Accepted residual risk (loopback-bound, token-gated, user-chosen URLs); per-hop re-validation; noted in ADR.                                   |
| Stale v0.2.0 reader vs `'companion'` origin value | Renames the manifest to `.invalid-<timestamp>`; needs a manual rename to recover. Content files untouched; schemas widened so it never recurs. |
| Readability output quality varies by site         | Preview-first modal — the user sees exactly what will be written before accepting; dismiss stores nothing.                                     |
| MS Learn ranked API shape drift (undocumented)    | Lenient zod parsing, fixture tests, silent fallback to shipped catalog scoring.                                                                |
| Large pages                                       | 4 MiB streamed fetch cap; 2 MiB source cap with visible truncation marker.                                                                     |
