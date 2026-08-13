# Open research stack evaluation

**Date:** 2026-08-05

**Scope:** cohesive topic search, extraction, source quality, citations, local synthesis, and setup

**Decision posture:** borrow proven patterns first; add a dependency only when it closes a measured gap

**Implementation follow-up (2026-08-13):** v0.13.0 implements local question routing, a keyless
browser Europe PMC adapter, a keyless browser Library of Congress adapter, DOI and conservative
scholarly-title deduplication, and aborting provider timeouts. The original 2026-08-05 evaluation is
retained below, with delivery statuses updated where those decisions have now shipped.

## Executive decision

Dusori does not need a second research application inside it. It already has the right trust
boundary: consented provider adapters, parallel lookup, typed failures, local source copies,
claim-level citations, a deterministic synthesis path, a guarded companion fetcher, SearXNG,
YouTube metadata, and optional Ollama.

Delivery status in the checkout reviewed here:

- **Existing:** the provider interface, browser and companion providers, typed run trail, guarded
  page fetch, claim extraction, deterministic synthesis, and optional AI boundary.
- **Implemented in the current worktree:** Crossref and Open Library providers, canonical-URL
  deduplication, stronger subject relevance, a larger diverse shortlist, truthful evidence/lens
  typing, model discovery plus one structured readiness check, and passage-selected local-AI
  synthesis with verbatim source wording.
- **Implemented in the v0.13.0 follow-up:** Europe PMC behind a narrow biomedical route, Library of
  Congress behind a narrow cultural-heritage route, fail-closed local provider selection, DOI and
  conservative scholarly-title deduplication, and real fetch aborts at provider deadlines.
- **Still recommended, not implemented by this note:** the deeper SearXNG profile, full provenance
  merging across identifiers, the full multi-state Ollama model picker, and any rendered-page
  fallback.

The strongest next move is to make these pieces feel like **one research engine**:

1. classify the question into source lenses;
2. fan out over the relevant providers and a configured metasearch service;
3. normalize identifiers and deduplicate before ranking;
4. show source coverage and failures instead of hiding them;
5. deep-read only approved URLs through a tiered extractor;
6. synthesize only from locally stored, cited passages;
7. let a local model improve prose and semantic grouping without becoming the evidence system.

Do **not** scrape Google result pages, add an unrestricted crawler, or replace the current
pipeline with a large Python/Next.js research product. A self-hosted SearXNG instance is the
appropriate "Google-like" discovery layer; specialized APIs supply higher-quality evidence.

### Project decisions

| Project                     | Decision                               | Reason                                                                                            |
| --------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Mozilla Readability         | Keep integrated                        | Small, already present, and appropriate for ordinary readable HTML                                |
| SearXNG                     | Keep as optional service; deepen setup | Best fit for one metasearch entry point without scraping Google result pages                      |
| GPT Researcher, STORM, Vane | Borrow patterns                        | Their planning, progress, and outline ideas fit; their full runtimes duplicate Dusori             |
| Local Deep Research         | Borrow evaluation/provider patterns    | Strong local-first comparison, but its Python/database application is a second product            |
| Europe PMC                  | Integrated in v0.13.0                  | Adds biomedical metadata and abstracts without treating them as full papers                       |
| Library of Congress         | Integrated in v0.13.0                  | Adds digitized cultural-heritage catalog references without copying item media                    |
| Citation.js                 | Integrate only for citation export     | Useful format conversion, but no gain to evidence quality                                         |
| Crawlee                     | Prototype only after measured need     | Best JavaScript rendered-fetch candidate, with substantial browser/security cost                  |
| Crawl4AI                    | Optional connector/design reference    | Capable, but adds Python/browser operations and a custom attribution-bearing license              |
| Firecrawl                   | Do not integrate now                   | Overlaps search and extraction; hosted use adds disclosure, and self-hosting adds AGPL operations |
| MarkItDown                  | Defer to local-document import work    | Good document converter, not a solution to current web-link failures                              |

## What Dusori already has

The current implementation should be extended rather than duplicated:

- provider contracts and routing in
  [`providers/index.ts`](../../packages/core/src/research/providers/index.ts);
- deterministic ranking, per-provider normalization, and diverse selection in
  [`rank.ts`](../../packages/core/src/research/rank.ts);
- canonical-URL deduplication and a durable run trail in
  [`agent.ts`](../../packages/core/src/research/agent.ts) and
  [`research-file.ts`](../../packages/core/src/research/research-file.ts);
- source claims and citation-preserving synthesis in
  [`claims.ts`](../../packages/core/src/research/claims.ts) and
  [`synthesis.ts`](../../packages/core/src/research/synthesis.ts);
- SearXNG, Brave, and Tavily as interchangeable companion search backends in
  [`research-websearch.ts`](../../packages/companion/src/research-websearch.ts);
- ordinary HTTP extraction with Mozilla Readability and SSRF/size controls in
  [`research-fetch.ts`](../../packages/companion/src/research-fetch.ts);
- Ollama, OpenAI, and Anthropic behind one bounded companion interface in
  [`ai.ts`](../../packages/companion/src/ai.ts).

Mozilla Readability is already the correct first extractor. It is Apache-2.0 and describes itself
as the standalone library behind Firefox Reader View
([repository](https://github.com/mozilla/readability),
[license](https://github.com/mozilla/readability/blob/main/LICENSE.md)). Fix and measure that path
before adding a browser crawler.

### Current and proposed provider matrix

"Readable" below means text that may be inspected for claims after capture. It never means the
whole underlying work unless the row says so.

| Status  | Provider / target lens       | Runs through / configuration                                           | Discovery and readable evidence                                                        | Canonical identity and limits                                                                       |
| ------- | ---------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Current | Microsoft Learn / Docs       | Browser catalog; companion ranked search; no key                       | Catalog or search reference only; an approved page may later use guarded page fetch    | Module UID when catalog-backed, otherwise final URL; never imply a module page was read             |
| Current | Wikipedia / Docs             | Browser; no key                                                        | Search plus MediaWiki plain-text page extract                                          | Page ID; encyclopedia text is readable but remains one source                                       |
| Current | Hacker News / Community      | Browser through the Algolia HN API; no key                             | Search reference only                                                                  | HN object ID; story title/snippet and votes are not article evidence                                |
| Current | GitHub / Docs                | Browser GitHub API; no key in the current provider                     | Repository discovery and README extract when available                                 | `owner/repository`; README is project documentation, not proof that code behavior is correct        |
| Current | Stack Overflow / Community   | Browser Stack Exchange API; no key, IP quota                           | Question-body extract; answers and the live thread are not captured                    | Question ID; votes/accepted-answer presence are ranking signals, not evidence from the answer       |
| Current | OpenAlex / Academic          | Browser; no key                                                        | Work metadata and reconstructed abstract when available                                | OpenAlex work ID plus DOI when present; abstract is not the paper                                   |
| Current | Crossref / Academic          | Browser public API; no signup; honor returned rate/concurrency headers | Bibliographic metadata and publisher-supplied abstract when present                    | DOI; label captured text **Abstract**, never full paper                                             |
| Current | Open Library / Books         | Browser public Search and Works APIs                                   | Work/edition metadata and catalog/community description; not book text                 | OL work/edition ID plus ISBN when present; description must remain metadata, not synthesis evidence |
| Current | npm / Docs                   | Browser registry API; no key                                           | Package metadata and registry README when present                                      | Package name; README is package documentation, not source-code inspection                           |
| Current | arXiv / Academic             | Companion proxy; keyless                                               | Paper metadata and author abstract                                                     | arXiv ID; abstract is not the paper                                                                 |
| Current | Reddit / Community           | Companion; user-created Reddit app credentials                         | Self-post text when present, otherwise reference; replies are excluded                 | Reddit post ID/URL; link posts and discussion-only items are not readable evidence                  |
| Current | Web search / Web             | Companion; SearXNG URL or Brave/Tavily key                             | Discovery references only; an individually approved result may later use guarded fetch | Canonical final URL; snippets are never evidence                                                    |
| Current | YouTube / Video              | Companion; YouTube API key or configured self-hosted Invidious         | Metadata/reference only; no media or caption harvesting                                | YouTube video ID; descriptions, views, and channel metadata are not a transcript                    |
| Current | Europe PMC / Academic-biomed | Browser REST adapter; no credential                                    | Metadata and returned abstract; no full-text follow-up                                 | PMID, PMCID, DOI; preserve identifiers and label captured text as an abstract                       |
| Current | Library of Congress / Web    | Browser JSON API; no credential                                        | Digitized-item catalog metadata and canonical reference only                           | Canonical `/item/` URL; 20 request starts/minute; rights vary; no media or page-text capture        |

Crossref's public REST pool currently allows access without signup and reports rate/concurrency
limits in response headers; its documentation asks clients to cache, identify themselves, and back
off on `429`
([Crossref access](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/)).
Open Library's Search API returns work and edition metadata, including OL identifiers; that is
catalog data, not the book itself
([Open Library Search API](https://openlibrary.org/dev/docs/api/search)).

The provider lens map now classifies Crossref as Academic and Open Library as Books. Keeping those
explicit mappings prevents coverage reporting from claiming an academic or book gap after that
provider already returned evidence.

Use one cross-provider evidence vocabulary in storage and UI:

- `reference` — title, URL, snippet, or metadata only; never available to synthesis;
- `catalog-description` — a third-party description of a work; visible but not work evidence;
- `abstract` — author/publisher abstract, citable only with an **Abstract** label;
- `excerpt` — a bounded passage from an approved readable page with section/location;
- `full-text` — only when the provider explicitly grants and delivers the underlying work.

This prevents Crossref abstracts and Open Library descriptions from being presented as if Dusori
read the paper or book. When duplicate records merge, keep every provider and evidence type on the
surviving source.

## Prioritized shortlist

### P0 — finish the cohesive engine without a new runtime dependency

#### 1. Turn the SearXNG adapter into a real metasearch profile

Keep SearXNG as a separately operated optional service. Its API supports categories, language,
page number, safe-search, and time range, and `/config` exposes the instance's enabled engines.
An instance may disable JSON unless that format is enabled, so setup must verify the configured
instance rather than assume it works
([search API](https://docs.searxng.org/dev/search_api.html),
[configuration API](https://docs.searxng.org/admin/api.html),
[license](https://github.com/searxng/searxng/blob/master/LICENSE)).

Borrow now:

- a companion health check that distinguishes unreachable, JSON-disabled, and ready;
- lens-to-category routing (`general`, `science`, `it`, `news`, `videos`) when the instance exposes
  those categories;
- language and freshness controls from the user's question;
- the engine names returned with each result, retained as provenance;
- explicit disclosure that a query is sent to the selected SearXNG instance and from there to its
  configured engines.

License/operations: SearXNG is AGPL-3.0. Calling a separately installed instance is a cleaner
boundary than copying its code into Dusori. If Dusori ever distributes a modified SearXNG image,
publish the corresponding source and notices as the license requires. If a modified instance is
hosted for network users, offer those users its corresponding source as well; distribution is not
the only AGPL trigger to plan for. Before enabling an upstream engine, review that engine's terms
and automation policy. Disable engines whose integration depends on prohibited result-page
scraping, even if SearXNG technically supports them.

#### 2. Repair YouTube as a reference provider

YouTube failure is a P0 path, not a future crawler problem. The official Data API and an Invidious
fallback need separate capability states: not configured, reachable, quota/rate limited,
authentication rejected, incompatible response, and upstream unavailable. The official search API
returns result metadata and consumes project quota; Invidious exposes its own instance stats and
search endpoints
([YouTube `search.list`](https://developers.google.com/youtube/v3/docs/search/list),
[Invidious API](https://docs.invidious.io/api/)).

Required behavior:

- prefer the official YouTube Data API when the user supplied a key; keep the unofficial Invidious
  path strictly opt-in and use only the exact self-hosted URL the user configured as fallback;
- never discover, recommend, or silently default to public Invidious instances;
- keep discovery metadata-only and persist the video ID, channel, duration, publish time, and the
  provider path that actually answered;
- always keep **Open on YouTube** usable in the system browser, even when discovery, thumbnails, or
  extraction fail;
- mark every saved video as a non-synthesizable reference until the learner supplies transcript
  text they own or are authorized to use;
- explain that state on the saved item instead of reporting a generic fetch failure;
- never fetch captions, media, or use `yt-dlp` or similar bypass/download tooling.

Google’s caption listing does not contain caption text; caption download is a separate API method
with its own authorization contract
([YouTube API reference](https://developers.google.com/youtube/v3/docs)). Invidious exposes caption
endpoints, but their existence is not permission for Dusori to harvest them.

For the official path, `search.list` supplies IDs and snippets but not duration. Batch the returned
video IDs into one `videos.list(part=contentDetails,statistics,snippet)` follow-up, then cache that
metadata and account for both calls in the provider outcome
([YouTube `videos.list`](https://developers.google.com/youtube/v3/docs/videos/list)). If enrichment
fails or quota is exhausted, keep the openable title/URL reference and mark duration/views
unavailable; do not turn a partial metadata failure into a broken link.

#### 3. Add a deterministic research planner, not an autonomous black box

The planner should create a small visible query set—overview, mechanisms, official material,
criticism/limitations, and recent developments—then route each query to relevant lenses. The user
can see, skip, or rerun any branch. This borrows the useful part of agentic research while keeping
the run reproducible.

Four mature sources support this shape:

- [GPT Researcher](https://github.com/assafelovic/gpt-researcher) separates planning, parallel
  execution, source tracking, filtering, and publishing (Apache-2.0;
  [license](https://github.com/assafelovic/gpt-researcher/blob/main/LICENSE)).
- [STORM](https://github.com/stanford-oval/storm) performs research and outline generation before
  cited long-form writing, and uses perspective-guided questions to broaden coverage (MIT;
  [license](https://github.com/stanford-oval/storm/blob/main/LICENSE)).
- [Vane, formerly Perplexica](https://github.com/ItzCrazyKns/Vane) classifies the question, can run
  research in parallel, offers speed/balanced/quality modes, and returns answer plus sources (MIT;
  [architecture](https://github.com/ItzCrazyKns/Vane/tree/master/docs/architecture),
  [license](https://github.com/ItzCrazyKns/Vane/blob/master/LICENSE)).
- [Local Deep Research](https://github.com/LearningCircuit/local-deep-research) combines local
  models, SearXNG, specialized engines, provider selection, persistent research history, and a
  published evaluation corpus. Its own documentation says it respects `robots.txt` and identifies
  its fetcher honestly (MIT;
  [license](https://github.com/LearningCircuit/local-deep-research/blob/main/LICENSE)).

Borrow their orchestration and progress vocabulary. Do not add these applications as dependencies:
they bring separate Python or Next.js stacks, their own persistence and prompts, and trust models
that would duplicate Dusori's portable workspace contract.

#### Map view — separate the research landscape before adding more nodes

The Map should be a readable research navigator, not one force-directed hairball. It can use the
same normalized sources and relationships as synthesis, but needs a deliberately constrained view:

- put source lenses into stable, visibly separated clusters—Official/Docs, Academic, Books,
  Community, Video, and Web—with a minimum inter-cluster gutter;
- lay sources out deterministically inside a cluster and run collision against the complete label
  rectangle, not just the node circle; cap label width at two lines and expose the full title on
  focus;
- collapse duplicate provider records into one work node and show provider badges on it, so adding
  Crossref or OpenAlex provenance does not add another visual copy of the same paper;
- start with cluster summaries and progressively disclose source nodes; selecting a cluster zooms
  to it, while selecting a source shows only its immediate evidence/citation neighborhood and
  fades unrelated edges;
- draw relationships only for the current focus or selected comparison. Edge bundling can help
  later, but simply not drawing every edge at once is the stronger first fix;
- use evidence type and capture state—not an unexplained trust score—for node shape/badge, and keep
  provider failure/gap counts on the cluster summary;
- provide a synchronized outline/list fallback grouped by lens, fully keyboard operable, with the
  same selection and open-source actions. The list is the reliable reading surface when a graph
  cannot remain legible at the current window size.

The acceptance fixture should include at least forty results across all lenses, duplicate DOI/URL
routes, long titles, failed providers, and a narrow window. At the default overview there should be
no overlapping cluster bounds; after opening a cluster, no visible labels should overlap, and a
user should be able to reach any saved source through either focus mode or the outline without
zooming out to the whole graph. This can be implemented in the existing Map renderer first; a new
graph library is justified only if those measurable layout rules cannot be met.

#### 4. Make source identity stronger than URL identity

Use a staged deduplication key:

1. canonical domain identifier when present—DOI, PMID/PMCID, OpenAlex ID, ISBN/OLID, GitHub
   owner/repository plus commit, YouTube video ID;
2. normalized final URL with tracking parameters and fragments removed;
3. bounded hash of normalized extracted text;
4. optional semantic near-duplicate grouping when a local embedding model is explicitly enabled.

The current URL dedupe is a good first layer, but DOI links, publisher links, and index records can
still describe the same work. Keep all provider provenance on the winning record rather than
silently dropping the alternate route.

Source quality must remain type-specific. A citation count is useful for papers, releases and
maintainer identity matter for repositories, accepted/voted answers matter for Q&A, and official
ownership matters for documentation. Do not collapse those signals into one unexplained global
"trust score."

#### 5. Route approved content by type

The current guarded fetcher deliberately rejects PDF. Academic and government results therefore
need a content-type router rather than a generic "URL fetch":

```text
HTML -> HTTP + Readability
PDF -> isolated PDF text extraction
JavaScript-only HTML -> optional rendered fallback
unsupported, encrypted, blocked, or failed -> reference
```

Reuse the `pdfjs-dist` dependency and extraction approach Dusori already uses for local curriculum
PDFs. PDF.js is Mozilla-supported and Apache-2.0
([repository](https://github.com/mozilla/pdf.js),
[license](https://github.com/mozilla/pdf.js/blob/master/LICENSE)). No new PDF dependency is needed.

The existing app-layer helper flattens page text for an imported local file, so it cannot be reused
unchanged for research citations. A remote-PDF route must use PDF.js through a Node-compatible,
isolated companion worker and return page-preserving records. The companion first fetches bytes
through the same URL guard as HTML, then hands only the bounded buffer to that worker. Enforce
compressed and expanded byte ceilings, page count, parse timeout, output-character limit, and
worker teardown. Reject encrypted/malformed files cleanly. Store page numbers and text offsets with
excerpts so a citation can lead back to a page. Do not add OCR by default: it needs separate local
tooling, image/decompression limits, language selection, and a clear "machine-read from image"
evidence label.

#### 6. Make Ollama setup a capability check, not an environment-variable lesson

Ollama's local API exposes installed models through `GET /api/tags`, model capabilities and context
metadata through `POST /api/show`, JSON-schema output through the `format` field on
`POST /api/generate`, and usage timing in generation responses
([list models](https://docs.ollama.com/api/tags),
[show model](https://docs.ollama.com/api-reference/show-model-details),
[generate](https://docs.ollama.com/api/generate),
[usage](https://docs.ollama.com/api/usage)).

The current checkout now auto-discovers a running loopback Ollama instance, selects the smallest
recognized chat model deterministically, and calls that model ready only after a small
schema-constrained generation succeeds. It exposes a failed state for a listed model that cannot
load. Finish the experience with at least five explicit service states: Ollama absent, installed
but stopped, running with no models, model listed but load/self-test failed, and ready with
selectable models.

The companion capability response should carry only diagnostic facts, never prompts or secrets.
Use five actionable states plus an honest `unavailable` fallback when the platform cannot determine
whether Ollama is installed:

```ts
type LocalAiStatus = {
  state: 'absent' | 'stopped' | 'no-models' | 'model-failed' | 'ready' | 'unavailable';
  installation: 'present' | 'absent' | 'unknown';
  endpoint: string;
  models: Array<{
    name: string;
    size?: number;
    capabilities?: string[];
    contextLength?: number;
    schemaTest: 'not-run' | 'passed' | 'failed';
    latencyMs?: number;
    errorCode?: string;
  }>;
  selectedModel?: string;
};
```

Probe and transition contract:

| Probe outcome                                                                                                          | State          | Recovery shown                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------- |
| Read-only platform detector finds no Ollama app/binary and loopback API is unreachable                                 | `absent`       | Link to official install instructions; never install automatically                              |
| Detector finds the app/binary but loopback `/api/version` or `/api/tags` is unreachable                                | `stopped`      | Ask the learner to start Ollama, then retry                                                     |
| Loopback API answers and `/api/tags` returns no models                                                                 | `no-models`    | Show the exact manual `ollama pull …` command only after the learner chooses a model            |
| Models are listed, but no tested candidate passes `/api/show` plus a tiny schema-constrained `/api/generate` self-test | `model-failed` | Show per-model failure code; suggest selecting another model, updating Ollama, or re-pulling it |
| At least one listed model passes `/api/show` and the schema self-test                                                  | `ready`        | Offer only passing models; remember the learner's choice locally                                |
| API is unreachable and installation presence cannot be determined, such as a restricted browser/companion environment  | `unavailable`  | Say Dusori cannot distinguish missing from stopped; show both manual checks                     |

Aggregate precedence is `ready` when any model passes, otherwise `model-failed` when models were
listed, then `no-models`, `stopped`/`absent` from the installation detector, and `unavailable` when
that detector is inconclusive. Platform detection is read-only: known application locations plus
executable discovery, with `unknown` rather than a guessed absence. Run `/api/show` and the tiny
schema test per selectable model, record bounded latency, and unload the probe (`keep_alive: 0`)
when supported.

Let the learner choose among models that passed the test, and remember that choice only on the
device. Never select by family name alone and never auto-download a model.

Use native structured output for reranking and synthesis envelopes instead of extracting the first
JSON-looking substring from prose. Keep the current deterministic fallback and continue sending
only bounded passages the learner approved—not an entire workspace.

### Local model finding — timestamped observation

Gemma 4 is real; it is not a mistaken name. Google documents the family, its Gemma 4 model card
lists Apache-2.0, and Ollama publishes an official `gemma4` library entry
([Google overview](https://ai.google.dev/gemma/docs/core),
[Gemma 4 model card](https://ai.google.dev/gemma/docs/core/model_card_4),
[Ollama model page](https://ollama.com/library/gemma4)). Check the exact model source and license
again before redistribution; a community variant may differ from Google's release.

Live check on 2026-08-05: Ollama 0.24.0 was started temporarily and listed
`gemma4:12b-it-qat` and `llama3.2:latest`. A schema-constrained generation probe failed to load the
Gemma 4 entry with the installed Ollama runtime, while the same probe succeeded with Llama 3.2.
Therefore Gemma 4 was **installed but not synthesis-ready** on this machine. The temporary Ollama
service was stopped after verification. This observation can change after an Ollama or model
update; the app must test live instead of relying on a manifest or model name.

### P1 — add narrowly scoped source reach

#### 7. Europe PMC for biomedical and life-science questions — delivered in v0.13.0

This is the strongest next specialist provider, not a provider to run for every topic. Europe PMC's
official REST service returns JSON/XML metadata, abstracts, citation links, and open-access full
text where available. It covers PubMed and additional life-science sources
([REST service](https://europepmc.org/RestfulWebService)).

Implemented boundary:

- route only when biomedical/life-science terms are detected or the user selects that lens;
- capture abstracts directly but do not follow full-text links;
- retain PMID, PMCID, DOI, author, and publication-date provenance where returned;
- use one bounded search request and the shared aborting provider deadline;
- never treat an abstract as the full paper.

For journal-quality context, DOAJ makes its journal and article metadata available under CC0 via
its API and data dumps. Use it as an explainable open-access/indexing signal, not as a guarantee of
article correctness ([DOAJ terms](https://doaj.org/terms/)).

#### 8. Add citation export only if users need it

[Citation.js](https://github.com/citation-js/citation-js) offers modular DOI, BibTeX, RIS, CSL, and
software-format plugins under MIT
([license](https://github.com/citation-js/citation-js/blob/main/LICENSE.md)). It is a reasonable
direct dependency for BibTeX/RIS/CSL export after the internal source identity model is stable. It
does not improve evidence quality by itself, so it should not block the current research repair.

### P2 — optional rendered-page fallback, never default crawling

A second extraction tier is justified only for approved pages that ordinary HTTP plus Readability
cannot read and that require JavaScript rendering.

Recommended shape:

```text
provider API
  -> HTML: ordinary HTTP + Readability
  -> PDF: bounded PDF.js extraction
  -> JS-only HTML: optional rendered fetch
  -> unsupported/failed: saved reference only
```

Every tier keeps the exact URL, final URL, retrieval time, content type, evidence type, truncation
state, and failure reason. The rendered tier needs a fresh temporary browser profile; no user
cookies, extensions, downloads, file access, persistent storage, service workers, or session reuse;
top-level and subresource network filtering; process/memory/time limits; and teardown after each
job. A failure remains a browser-ready reference.

Projects evaluated:

| Project                                               | Useful capability                                                                           | Fit for Dusori                                                                                                                                          | License and operational cost                                                                                                                                                                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Crawlee](https://github.com/apify/crawlee)           | TypeScript HTTP and Playwright crawlers, request queues, retries, storage                   | Best code-level option for a later companion-only rendered fallback; borrow queue/retry ideas now                                                       | Apache-2.0 ([license](https://github.com/apify/crawlee/blob/master/LICENSE.md)); browser binaries and subresource SSRF controls add substantial bundle and test cost                                                                                  |
| [Crawl4AI](https://github.com/unclecode/crawl4ai)     | Browser rendering, clean Markdown, citation/reference extraction, robots option, Docker API | Better as an optional external connector or design reference than an embedded dependency                                                                | Custom Apache-2.0-based license with an added mandatory public attribution term ([license](https://github.com/unclecode/crawl4ai/blob/main/LICENSE)); direct adoption needs license review; Python/browser runtime and a local service add setup cost |
| [Firecrawl](https://github.com/firecrawl/firecrawl)   | Search, scrape, crawl, map, structured extraction, hosted or self-hosted                    | Do not integrate now; it overlaps both search and extraction, encourages a second source store, and its hosted path sends URLs/content to a third party | Repository root is AGPL-3.0 ([license](https://github.com/firecrawl/firecrawl/blob/main/LICENSE)); verify any per-directory exceptions; self-hosting is heavy and a hosted adapter needs a new privacy disclosure                                     |
| [MarkItDown](https://github.com/microsoft/markitdown) | Converts PDFs and Office/local documents to Markdown with a plugin model                    | Useful later for local-file import, not as a web scraper                                                                                                | MIT ([license](https://github.com/microsoft/markitdown/blob/main/LICENSE)); Python runtime, and its own security notes require callers to restrict paths, schemes, and destinations                                                                   |

Do not use Crawlee's stealth/fingerprint/proxy features or any system intended to bypass blocks.
That conflicts with [ADR-011](../adr/011-provider-access-and-lawful-capture.md). The goal is to read
content the learner is allowed to access, not to defeat a site's controls.

The capture policy applies equally to HTTP, PDF, and rendered HTML: an individually approved
`http/https` URL without embedded credentials; safe ports; every redirect and every DNS answer
revalidated; IPv4, IPv6, loopback, private, link-local, and cloud-metadata destinations blocked;
DNS pinned through connection; bounded redirects, time, compressed bytes, expanded bytes, and
output; no cookies or session reuse; robots/site policy and per-host rate limits respected. A
headless browser must not become a way around the guard already enforced for ordinary fetches.

## Trust controls across the pipeline

Fetched pages, snippets, repository text, metadata, PDFs, captions supplied by a user, and
citations are untrusted data. Delimit them as data in prompts. The synthesis model gets no tools,
network, filesystem, or provider credentials; it receives only bounded passage IDs from approved
local sources. Schema validation must restrict returned passage IDs to that supplied set. Reject
invented IDs, malformed output, and any instructions embedded in source material, then use the
deterministic fallback.

"Local AI" means a verified loopback endpoint. A LAN host or custom Ollama-compatible URL is a new
recipient and needs separate disclosure naming the endpoint and exact payload scope before even a
readiness probe. Do not log prompts, passages, generated prose, tokens, or credentials. Never store
provider keys in the workspace; name the actual SearXNG, Brave, Tavily, Reddit, YouTube, or AI
recipient before its request and collapse upstream errors so secrets cannot echo into the UI.

Capture and retention must follow the source's terms: prefer metadata and bounded passages over
whole-page copies; preserve license/access provenance; identify abstract, catalog description,
excerpt, and full text distinctly; and allow a saved copy to be deleted. Search snippets never
become evidence merely because they were stored.

Use a concrete default purge policy: discard raw HTTP/PDF response buffers immediately after a
bounded excerpt is saved, destroy rendered-browser profiles and caches at job end, and retain only
redacted diagnostic codes/latencies for 30 days before automatic deletion. Intentionally saved
source records and bounded excerpts remain workspace artifacts until the learner deletes them;
temporary captures and diagnostics must not silently become a second archive. Let the learner
shorten diagnostic retention or purge it immediately.

For any future crawler, plugin, Docker image, or `uvx` comparison harness: pin version and
integrity, inspect transitive dependencies and install scripts, generate notices/SBOM, isolate it
from credentials and live workspaces, and do not permit browser/runtime downloads without explicit
approval.

## One-search architecture to implement

```text
question
  -> visible query plan
  -> lens router
       -> official/docs APIs
       -> academic APIs
       -> books/community/video APIs
       -> configured SearXNG/Brave/Tavily metasearch
  -> identifier + URL + content dedupe
  -> type-aware ranking and coverage check
  -> shortlist with reasons and provider failures
  -> user-approved deep read
  -> exact passages with source locations
  -> deterministic evidence digest
  -> optional local-model prose over those passages
```

Two loops keep quality bounded:

- **Fast scan:** one query plan, parallel providers, eight diverse results, visible lens gaps.
- **Deep pass:** read selected sources, identify missing/contradictory coverage, run at most one
  follow-up query per gap, then synthesize.

This is enough agent behavior. Recursive crawling until an LLM decides to stop would make runtime,
cost, privacy, and reproducibility unpredictable.

## Skills and developer tooling

GPT Researcher now ships an official minimal Codex plugin/skill backed by its MCP server
([skill](https://github.com/assafelovic/gpt-researcher/tree/main/skills/gpt-researcher),
[plugin manifest](https://github.com/assafelovic/gpt-researcher/blob/main/.codex-plugin/plugin.json)).
It can be useful as a **developer-side comparison harness**: give it the same fixed topic corpus as
Dusori, compare source coverage/citations, and turn misses into provider or ranking fixtures. Do not
make it the product's hidden runtime; it executes a Python package through `uvx` and has its own
retrievers, model configuration, and data flow.

It was evaluated here but **not installed and not added to Dusori**. If installed later, pin the
Apache-2.0 project version and `uvx` package resolution, inspect its MCP configuration and
dependencies, run it without live workspace or unrelated credentials, and disclose that its
configured search/model providers receive the benchmark query. No external skill is recommended
as Dusori's runtime.

A small Dusori-specific evaluation skill would be more valuable for day-to-day quality. Its fixed
input should be a versioned manifest of topic, query intent, expected lenses, required primary
identifiers/domains, allowed network fixtures, and whether readable evidence is expected. It
should:

- run a frozen corpus spanning certification, general knowledge, software, books, biomedical
  topics, regulation/government guidance, standards/specifications, current news, and deliberately
  conflicting evidence;
- record provider found/empty/failed outcomes and source-domain diversity;
- flag duplicate works across URLs/identifiers;
- verify every synthesized sentence is supported by stored passages;
- compare deterministic output with each consented local model without auto-downloading one;
- emit a Markdown report and never modify a user's live workspace.

Its output contract should include, per fixture and aggregate: provider/lens found-empty-failed
coverage, canonical-identifier duplicate rate, source-domain diversity, readable-evidence ratio,
unsupported synthesis sentence count, valid-citation ratio, and whether every failure remained
visible. A pass/fail threshold belongs in the versioned manifest so model or provider changes are
measurable rather than subjective.

Build that only after the app behavior is stable; otherwise the skill will encode a moving target.

## Recommended sequence

1. Keep the completed link/fetch/map, Crossref, Open Library, deduplication, and initial Ollama
   readiness work covered by the fixed verification suite.
2. Add YouTube's explicit capability states; keep the repaired system-browser link and keep video
   references out of synthesis unless the learner supplies authorized transcript text.
3. Add SearXNG diagnostics, categories, language/freshness routing, and a visible query plan while
   preserving the Crossref/Open Library evidence typing and lens map.
4. Add canonical identifiers and provider-provenance merging; measure duplicate reduction on a
   fixed topic corpus.
5. Add the PDF.js content route and five-state Ollama readiness/model picker; keep the working
   Llama 3.2 path available while Gemma 4 fails its live compatibility probe.
6. Keep the delivered Europe PMC and Library of Congress lenses covered by stable fixtures,
   fail-closed routing tests, CSP parity, and provider-specific request limits.
7. Prototype one isolated rendered-fetch adapter against a fixture set. Ship it only if it recovers
   enough approved pages to justify browser/runtime and security cost.
8. Add Citation.js export or MarkItDown import only in response to demonstrated user demand.

## Non-negotiable boundaries

- "All sources" is not a truthful promise. State which lenses were searched, which providers were
  unavailable, and which pages were references rather than readable evidence.
- Never equate provider availability with a successful search.
- Never cite search snippets as if the page was read.
- Treat source content as hostile data; never execute its instructions or grant a synthesis model
  tools/network access.
- Never send a workspace or saved sources to a model before separate consent.
- Call an AI endpoint local only when it is verified loopback; disclose LAN/custom endpoints.
- Never let AI remove citations, invent sources, or overwrite user-edited Markdown.
- Never bypass authentication, paywalls, robots rules, private-address protections, or platform
  restrictions.
- Credit every integrated project in notices/documentation and re-check its exact license at the
  version pinned for release.
