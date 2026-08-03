# Dusori product specification

**Status:** v0.11.0 release · **Date:** 2026-08-03

## Product contract

Dusori is a free, open-source, local-first learning workspace with a deterministic baseline that works without AI. Users may keep a workspace inside browser-managed storage or, on supported platforms, grant access to one local folder. The same portable Markdown/JSON structure is used in both modes.

The application has no hosted backend, account system, telemetry, hosted analytics, or paid core dependency. Obsidian compatibility means writing ordinary Markdown and wikilinks inside a user-selected `<Vault>/Dusori/` folder; Obsidian itself and plugins are optional.

## Current milestone

The first milestone must prove:

1. Browser workspace creation and restoration.
2. Direct real-folder access where the File System Access API is supported.
3. One topic with overview, roadmap, preferences, state, note, sources, and dated updates.
4. Sanitized Markdown, wikilinks, and one strict Mermaid diagram.
5. Conflict detection that never silently replaces an external edit.
6. ZIP export/import with the same logical tree.
7. Offline use after the initial application load.
8. A loopback-only companion security foundation.
9. Keyboard, responsive, contrast, and automated accessibility gates.
10. A public GitHub repository, product page, documentation, and PWA on GitHub Pages.
11. An interactive learning loop derived entirely from portable roadmap, state, and update files.
12. Consent-gated, keyless research against Microsoft Learn and English Wikipedia.
13. Optional companion-powered readable-page extraction and ranked Microsoft Learn search, with explicit per-fetch confirmation.
14. In-app creation and conflict-safe editing of portable Markdown notes.
15. Local full-text search, backlinks, and a non-mutating workspace health report.
16. Deterministic review ordering and a bounded recap derived from dated local updates.
17. Whole-archive import validation with rollback if replacement storage fails.
18. A version-aligned, packed-tarball-tested npm companion command.
19. Optional, explicit spaced-review scheduling stored in portable topic files.
20. Automatic, consent-gated research across five keyless browser providers with deterministic multi-provider ranking.
21. Companion-backed arXiv and configured Brave, Tavily, or SearXNG web search, plus optional consent-gated AI assistance.
22. Local learning insights derived from roadmap, graph, source, and dated-update files without telemetry or inferred study time.
23. Deterministic, source-grounded active-recall sessions started from the review queue, ending in the existing explicit review action.
24. Companion-backed YouTube discovery through an operator-configured Invidious instance, with caption capture and a proxied thumbnail.
25. Tags derived from ordinary Markdown, surfaced in search, the graph, and insights without an index.
26. Two further keyless browser providers, OpenAlex and the npm registry, each reaching readable text.
27. A companion-backed Reddit provider gated on an operator-supplied Reddit application credential.
28. Single-topic export as a portable bundle that is explicitly not a re-importable workspace.
29. Derived review-queue pressure and a bounded due histogram in insights.
30. One health repair that only creates a file an existing wikilink already names.
31. Local PDF text extraction into the existing source path, with no OCR and no upload.
32. Structured, conflict-safe editing of a topic's learning preferences, with optional AI proposals.
33. Evidence-driven Today continuation and attention lanes, backed by a durable topic-local proposal lifecycle.
34. A durable, inspectable research trail that records every run's per-provider outcome, so a provider failure is never reported as an absence of material.
35. Topic-level research angles that ask about the subject itself rather than only about a roadmap objective.
36. Deterministic extraction of verbatim quoted passages from approved local source text, and a cited synthesis built from them.
37. An optional self-contained interactive learning page generated from those quoted passages.
38. In-app reading of that learning page from a sandbox that denies it the application's origin.
39. Per-topic standing permission to re-scan a stale mission when the application is opened, with no closed-app work.
40. Optional model-written synthesis overview prose over already-quoted passages, with the deterministic document as its fallback.

The shipped source library accepts pasted text, local `.md`/`.markdown`/`.txt`/`.pdf` files up to 2 MiB, and `http://` or `https://` URL references. URL capture stores the reference without fetching remote content. A PDF is read on the device with a lazily loaded browser library, never uploaded; a PDF with no text layer reports that cause rather than storing an empty source, because Dusori ships no OCR. Every new source is hashed, recorded in the topic manifest, and appended to the dated update log.

Tags are derived from ordinary Markdown on read: a `tags:` frontmatter list or an inline `#tag`, matching what Obsidian already understands. No tag index is stored. Workspace search accepts a `tag:` filter, the graph carries tags onto each node, and insights count the tag vocabulary. A Markdown heading, a bare number, a URL fragment, and any `#` inside code are never read as tags.

Learning preferences in a topic's `TUTOR.md` are edited structurally: a depth and a list of one-line preferences. Writes use the same tracked-hash protocol as `roadmap.md`, so a change is shown as a diff and applied only on explicit acceptance, and an external edit produces a sibling proposal. Only the depth line and the preference bullets are rewritten. With the companion, a configured provider, and a consent separate from research AI, a model may propose a depth and preference list from the topic title, the current preferences, and the learner's typed request; the reply is re-rendered onto the existing file, so it can change nothing else, and an unusable reply changes nothing at all.

The shipped curriculum importer accepts pasted Microsoft Learn study-guide Markdown with the English `Skills measured` hierarchy, AWS Certification exam guide outlines, and general structured Markdown syllabi. It extracts at most 200 objectives locally, previews them before writing, preserves the original outline as a topic source, and updates `roadmap.md` through the same conflict-safe acceptance protocol. The optional official URL is provenance metadata only and is never fetched.

An AWS exam guide can also be read directly from a PDF. Extraction happens on the device and preserves the guide's own line breaks, which is what makes its domains and task statements recognizable at all; a page read as one block carries no outline. The text lands in the same reviewable outline field as pasted text, so the cover page or an appendix can be trimmed before previewing, and the filename seeds the source title. A PDF of any other shape reports that no format matched and leaves its text in the field to edit. OCR for a scanned PDF and a PDF-native outline adapter remain unbuilt.

The shipped learning loop parses ordinary Markdown task syntax from `roadmap.md`. Users can complete or reopen an objective, set a topic to active, paused, or complete, and review a deterministic **Today** summary of progress and next steps. **Continue learning** excludes complete topics, orders due spaced reviews first, then active topics before paused topics using oldest `state.json.updatedAt` first with stable title and slug tie-breakers. Its action is derived from current evidence: a due source-ready topic starts review, an unfinished objective without approved readable text opens Research, another source-ready objective opens its roadmap and may offer an optional first review, and a paused topic opens without silently resuming it. **Needs attention** contains only current workspace evidence, with pending proposals and invalid or missing source records ahead of unresolved-link hygiene, and routes each item to its owning workflow. Opening either lane changes no progress. The seven-day recap reads bounded recent entries from dated update files. An explicit review action ("Got it" or "Needs work") stores a fixed-ladder interval (1, 3, 7, 14, 30, then 60 days) in the topic's machine-owned `review.json` and sets the next due date; a scheduled topic rests until due, a topic never marked reviewed remains unscheduled, and no calendar, notification, or closed-app schedule is ever generated.

A queue item can also start a source-grounded review session. Dusori builds three to five active-recall prompts from transparent templates over the current roadmap objective, the headings of that topic's approved sources, and bounded excerpts of their local text. Only sources whose text exists on the device are eligible; a URL kept as a reference is reported with the manual routes to readable content and is never fetched automatically. Every prompt names its source title, section, and workspace path, and its excerpt stays hidden until the learner asks to see it. Each prompt has an answer box. A session is otherwise ephemeral: starting, navigating, revealing, and abandoning write nothing, and only the final explicit "Got it" or "Needs work" reaches the existing review schedule. Typed answers stay in the session unless the learner saves them, which creates one ordinary Markdown note under `Topics/<slug>/Notes/` through the existing note path, reproducing the answers verbatim and quoting each prompt with its generator and source path. Leaving a session with unsaved answers asks once before discarding them. No score, streak, or mastery claim is produced or stored. With the companion running, a configured AI provider, and a separate consent covering source excerpts, a model may reword the prompts only; prompt count, order, evidence, and the review actions are fixed, generated wording is labeled with its model, and any failure keeps the deterministic prompts.

The shipped note editor creates Markdown under `Topics/<slug>/Notes/`, records it in `state.json`, and opens it directly for editing. Existing note saves use the same tracked-hash protocol as roadmap writes. An external edit remains active; Dusori stores the user's draft as a sibling proposal and requires an explicit acceptance step. Pending state is recorded in the topic's schema-versioned, hash-guarded `proposals.json` ledger, so the exact diff survives reload, import, and export. Accepting the proposal or keeping the current document records an `accepted` or `kept` resolution while preserving both Markdown versions. Historical `.proposed-*` files without a ledger entry remain readable history and are never inferred to be pending.

The shipped ZIP export can also write a single topic as a portable bundle. That bundle is a copy to read or keep elsewhere, not a workspace archive: importing a topic into an existing workspace would need merge rules that do not exist, so both the action and a note inside the archive say so.

Workspace health may create one kind of file: the document an unresolved wikilink already names, at the exact name the link uses. This stays inside the storage rules because new files may be created automatically, while existing Markdown may not be changed without explicit acceptance. Every such creation is recorded in `state.json` and appended to the dated update log.

The shipped workspace search scans `.md` and `.txt` files in the current session. Matching is case- and accent-insensitive and requires every query term. Results are bounded, source titles are read from valid manifests when available, and no index, query log, database, or network request is created. Backlinks reverse resolved wikilink edges. Workspace health combines unresolved wikilinks with source-manifest/file consistency and proposal-ledger validation; it never repairs or quarantines invalid machine state implicitly.

The shipped ZIP import path normalizes and validates the entire archive before replacement confirmation, including required workspace/topic schemas, file count, and compressed/expanded size limits. The destination is untouched when preflight fails. If a storage write fails during replacement, Dusori restores the previous snapshot before surfacing the error.

The shipped Research workspace starts from a selected roadmap objective and defaults to the next unchecked item. Creating a topic arms one automatic discovery run; granting the first provider consent starts it. Later runs are explicit. Seven keyless browser providers ship: Microsoft Learn, English Wikipedia, Hacker News, GitHub, Stack Exchange, OpenAlex, and the npm registry. OpenAlex rebuilds a work's abstract locally from the inverted index it publishes; an npm capture stores the package's published readme.

Each provider is blocked behind an exact egress disclosure naming its host and what leaves the device. Consent is stored per provider on the device. Every allowed provider is queried in parallel; one timeout or failure yields a visible skip notice without failing the run. Deterministic ranking combines objective relevance, provider-relative community signals, recency, and a bounded host-reputation nudge, then selects a diverse top-five shortlist. Ranking reasons remain visible. Accepted captures reuse the normal URL-source path, keep `method: "url"`, deduplicate by URL, record capture origin, append the dated update log, and remain ordinary portable Markdown. Dismissed and previously seen suggestions are kept in the topic's machine-owned `research.json` file.

Research is organized as per-topic missions whose status is derived from workspace files and never stored. **Today** opens with one strip per unfinished topic reporting candidates discovered, sources saved, sources read, quoted passages held, when the topic was last refreshed, and which of five source lenses — documentation, academic, community, video, and general web — have nothing saved yet. A provider that failed on the most recent run is named there, so incomplete coverage never reads as an empty field.

Every run is recorded in the topic's `research.json` as a bounded trail of at most fifty entries: the time, the exact text sent to providers, the angle that seeded it, how many candidates were new, and one entry per provider carrying `found`, `empty`, or `failed` with a count and the failure's own message. A run in which every provider failed is recorded like any other. The Research view renders that trail, so what happened survives a reload.

A topic can be researched from five deterministic angles — definition and scope, how it works, debates and criticism, practice and tools, and recent developments — each sending the topic's own name plus that angle's words. A roadmap objective remains selectable for curriculum topics. Angles are derived from the topic title at read time and never stored.

Saved sources keep the ranking reasons that surfaced them, the publisher, the author where a provider reports one, and any publication date. Reading saved sources extracts at most twelve verbatim excerpts per source from text already on the device, each tagged with the heading it sat under; excerpts are quotations, never paraphrase, and no model participates. A source holding only an unfetched reference is reported as such with the route to its text, and is never silently skipped.

A topic's synthesis is written to `Synthesis.md` as ordinary Markdown carrying `generated: synthesis` frontmatter. It groups quoted passages by subject, names which ideas more than one source supports, marks single-source ideas as thin evidence rather than stating them plainly, builds a timeline once at least three sources carry publication dates, lists the open questions the evidence itself raises, and names the lenses with nothing saved as a gap in coverage rather than an absence of material. Every line is a quotation carrying a link back to its source file. First creation writes the file; every rebuild afterwards goes through the ordinary propose-and-accept protocol, so an edited synthesis is preserved and the rebuild waits as a proposal. With companion AI consented, a model may write the overview prose only; it is labeled with its model name, and the quoted passages, citations, and evidence accounting stay deterministic.

A well-supported topic can be turned into `Learning/learn.html`: a self-contained interactive page with concepts and their supporting quotations, an optional timeline, and reveal-style check-yourself prompts that keep no score and store nothing. The page inlines its own styles and script, issues no network request of any kind, works offline, opens outside Dusori, and travels in the ZIP export. It is machine-owned and tracked in `state.json`; a page edited outside Dusori is preserved and the rebuild is written beside it.

With the local companion running, Microsoft Learn search instead proxies Microsoft's own ranked search API, falling back silently to local catalog ranking if that call fails. The companion also unlocks arXiv and one configured general web-search provider: Brave, Tavily, or a keyless open-source SearXNG instance. A Reddit provider appears when `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` name an application the operator registered, because Reddit no longer answers anonymous clients; without them the provider reports that it is not configured and the run skips it. Posts marked over 18 are excluded, a self post is captured as its own text, and a link post is captured as a reference that says so. Search credentials stay in the companion process. A URL source can be upgraded to the page's readable text after a per-fetch confirmation that names the exact host; the companion validates every address—including each redirect hop—against private, reserved, and other non-public ranges, follows at most three re-validated redirects, and caps pages at 4 MiB.

A YouTube provider appears when `INVIDIOUS_URL` names an Invidious instance. Dusori ships no default instance. The companion performs every request: search ordered by view count, the thumbnail (returned as image bytes and rendered by the app from an object URL, so no remote image origin is added to the content-security policy), and, on approval, the video's captions. The browser never contacts YouTube, Google, or their image hosts. A captioned video is captured as ordinary readable Markdown that states captions are frequently machine-generated; a video without captions is captured as a reference that says so. Video sources are never played inside Dusori.

Ollama, Anthropic, or OpenAI may be configured in the companion. AI egress has a separate consent disclosure. AI ranking is advisory: it reorders and annotates the deterministic candidate set but cannot remove candidates, and any failure keeps deterministic order. A research brief is created only after source approval. Deterministic briefs group links and state that pages were not read; AI-written briefs name their model and the approved-source boundary.

The shipped Insights view derives a bounded fourteen-day activity pulse, objective completion, artifact mix, connected-artifact percentage, link health, topic depth, graph hubs, provider provenance, tag distribution, and review-queue pressure from current local files. Review pressure counts overdue, due-today, scheduled, and unscheduled topics and shows a bounded due histogram; a topic never marked reviewed is reported as unscheduled rather than overdue. It does not persist an analytics index, estimate study time, infer mastery, or invent a score.

## Explicitly not built yet

- Any research, refresh, or source acceptance while the application is closed
- Fetching arbitrary page text without the local companion
- OCR for scanned PDFs or other image-only documents
- AI-generated diagrams
- Free-form chat that edits arbitrary workspace files
- Scoped import of a single-topic bundle into an existing workspace
- Inline video playback, watch history, playlists, or channels
- Closed-app or unattended background work
- Accounts, sync, telemetry, or hosted storage

Remote-page fetching from the hosted app alone is not planned. A browser cannot fetch
arbitrary third-party pages, and the only workaround is a proxy, which would be the hosted
backend this product does not have. The local companion covers that need instead.

## Trust model

Grounded generation is not a guarantee against unsupported output. Future AI behavior must keep source provenance visible, mark generated content, show diffs before replacing user-visible text, sanitize all output, and retain the deterministic scaffold as a fallback.

Source text is untrusted data—not executable instructions. Remote egress must be disclosed before any content is sent to an explicitly selected provider.

## Storage ownership

- Markdown is user-owned.
- JSON is machine-owned, schema-versioned, and validated.
- New files may be created automatically.
- Existing Markdown requires explicit acceptance before a matching version is changed.
- A stale version produces a sibling proposal, a pending lifecycle entry, and an append-only update entry.
- Accepting a proposal or keeping the current document resolves the lifecycle entry without deleting either Markdown version.
- Migrations create recoverable backups.
- Every operation remains inside the selected Dusori root.

This specification supersedes the earlier Python/FastAPI/pipx delivery architecture, keyless DuckDuckGo dependency, parameter-count model tiers, and the claim that an LLM “never invents.”
