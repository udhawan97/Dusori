# Changelog

All notable Dusori changes are documented here. Dusori follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.8.0] - 2026-07-30

### Added

- **Today** now opens with two workspace-wide, file-derived lanes. **Continue learning** routes due source-grounded reviews, objectives that need research, ordinary roadmap continuation, and paused topics without changing progress. **Needs attention** gives integrity issues priority, keeps unresolved-link hygiene secondary, and routes every item back to its existing owning workflow.
- Pending Markdown proposals now have a schema-versioned, hash-guarded `Topics/<slug>/proposals.json` lifecycle ledger. Proposal review survives reloads; accepting the proposal or keeping the current document resolves the attention item while preserving both Markdown versions. Historical proposal files are left untouched and are never guessed to be pending.

## [0.7.1] - 2026-07-29

### Fixed

- Reopening Dusori without a network connection works from the view you left. The app writes the open topic and view into its own URL, but the offline lookup ignored the query string and its fallback pointed at a shell that was cached under the server root instead of the app, so any return after real use ended on the browser's error page. The shell is now precached and matched where the app actually lives.
- The first run offers a workspace without scrolling. The setup hero reserved most of the opening screen, which left both workspace choices — the only way to begin — below the fold at every supported size. On desktop the choices now sit beside the hero, which keeps its display type.
- Research, the view a new topic opens on, shows its objective and provider controls in the first screen instead of a full-height headline followed by a screen of scrolling.
- Naming a topic starts from an empty field. The form arrived pre-filled with the example "AI Fundamentals" as a real value, so a first Enter created a topic and folder named after the example.
- The mobile navigation drawer takes keyboard focus when it opens, keeps Tab inside itself while it covers the canvas, and returns focus to the menu button when dismissed.
- The workspace rail reports connectivity as it changes rather than freezing on whatever was true when the page first painted.
- A long topic name truncates its own label instead of also crushing its icon to a sliver.
- The disabled **Scan for strong sources** button now names the permission it is waiting for through an accessible description, and the status toast no longer swallows clicks aimed at the controls beneath it.
- OpenAlex and npm discovery work from the hosted app. Their providers now declare the remote hosts they use, and the deployed content-security policy allows exactly those hosts.
- Research run history, result dismissal, and source import now preserve the useful retry-exhausted message when a concurrent workspace edit cannot be reconciled, instead of replacing it with a generic conflict.
- Publishing a GitHub release now starts the npm companion workflow against that exact tag. The workflow verifies the tag, package, and runtime versions agree, runs the full repository and packed-package gates, and publishes the scoped package with provenance.

## [0.7.0] - 2026-07-28

### Added

- Nodes can be placed by hand. Dragging a node pins it where it is dropped rather than letting it drift back, and its neighbors resettle around the new position. A focused node moves from the keyboard too — arrow keys nudge it, Shift takes a larger step — so placement never requires a pointer. **Release pins** returns every placed node to the layout.
- The graph filters on what the workspace already knows instead of a query language: **Show on the graph** chips toggle Notes, Sources, Updates, Documents, and Meta, and **Hide orphans** drops artifacts carrying no wikilinks. The workspace center and topic centers always stay visible, and the panel reports how many artifacts survive the filter.
- **Color by** switches artifact dots between **Kind** and **Topic**. Topic hues are derived from the topic name and shown in a legend, so the same workspace always draws the same colors. Filters and the color choice persist per browser alongside the force sliders.

### Changed

- The Artifact finder now narrows within what the graph is drawing rather than searching the whole workspace independently, so hiding a kind on the stage also removes it from the list. The graph filter decides what exists on screen; the finder locates something inside it.

## [0.6.0] - 2026-07-27

### Changed

- The knowledge graph is now explorable and adjustable, Obsidian-style: zoom toward the cursor (wheel or pinch, plus keyboard-operable buttons and a slider), drag to pan, and tune **Link length** and **Spacing** with sliders that persist per browser. The constellation seed is relaxed by a deterministic force pass, so linked notes pull together while everything keeps a readable distance; labels fade in as you zoom, hovering highlights a node's neighborhood, artifact dots grow with their wikilink degree, and reduced-motion users get an instant settled layout.
- Research and Insights are first-class workspace views. Creating a topic now opens Research and begins one automatic discovery run as soon as at least one provider is allowed; later scans remain explicit.
- The graph now opens with a notes/sources/wikilinks health ledger and a searchable, filterable artifact finder beside the constellation.

### Added

- **Start review** on the **Review next** queue opens a source-grounded session: three to five deterministic active-recall prompts built from the topic's current roadmap objective and the sources you already approved for it. Each prompt names its source title, section, and workspace path, and holds a bounded excerpt back until you ask to see it. Only sources whose readable text is on this device are used; a URL stored as a reference is named with the two manual ways to give it text, and Dusori still never fetches a page on its own. Each prompt has an answer box; what you type stays in the session until you choose **Save answers as a note**, which writes one ordinary Markdown note holding your answers verbatim with each prompt quoted, labelled by generator, and pointing at its source file. Leaving with unsaved answers asks once. Sessions are otherwise ephemeral — opening, walking, revealing, and abandoning write nothing — and only the final explicit "Got it" or "Needs work" reaches the existing schedule. No score, streak, or mastery claim is produced.
- With the companion running and an AI provider configured, **Allow sharper prompts** can reword those questions. It asks for its own consent, separate from AI ranking, because it sends the objective and up to four short source excerpts and nothing else. The model can change wording only: prompt count, order, evidence, and the review actions are fixed, generated wording names the model that wrote it, and a refusal, a malformed answer, or a twenty-second timeout keeps the deterministic prompts with a visible note.
- A **YouTube** research provider, through an Invidious instance you configure in the companion (`INVIDIOUS_URL`). Results are ordered by view count, and approving a video downloads its captions so it becomes an ordinary readable source that search, the graph, briefs, and review prompts can all use; a video without captions is stored as an honest reference instead. Dusori ships no default instance, and your browser never contacts YouTube, Google, or `ytimg.com` — even the thumbnail is proxied by the companion and rendered from local bytes, so the app's content-security policy gains no new remote origin.
- Curriculum import now recognizes AWS Certification exam guides: paste the content outline copied from an official AWS exam guide PDF and Dusori extracts the weighted `Domain N:` sections and `Task Statement N.N:` items, merging the duplicated summary table and rejoining lines the PDF wraps mid-sentence. When no format matches, the error now names every supported outline instead of a generic hint.
- A deterministic research agent queries every consented provider concurrently, survives partial failures, ranks candidates from explainable public signals, and preserves a diverse top-five shortlist. Keyless browser providers now include Hacker News, GitHub, and Stack Exchange alongside Microsoft Learn and Wikipedia.
- The local companion adds arXiv and configurable Brave, Tavily, or SearXNG general web search. Optional Ollama, Anthropic, or OpenAI assistance can advise ranking and write a model-named brief from approved sources; deterministic behavior remains the fallback.
- Local Insights derives a fourteen-day activity pulse, objective progress, artifact mix, link health, topic depth, connected hubs, and source provenance without telemetry, inferred study time, or a proprietary score.
- **Tags**, read from the Markdown you already write: a `tags:` list in frontmatter or an inline `#tag` in the body, exactly as Obsidian understands them, so a vault edited outside Dusori keeps the same tags. Search gains a `tag:name` filter and shows the tags it found; the graph carries tags onto each node and filters by them; Insights counts your tag vocabulary. Nothing is indexed or stored — tags are read from the files each time, and a Markdown heading, an issue number like `#123`, a URL fragment, and anything inside code are never mistaken for one.
- Two more keyless research providers your browser can reach on its own: **OpenAlex** for scholarly work and the **npm registry** for packages. Both reach real readable text rather than a bare link — OpenAlex abstracts are rebuilt locally from the inverted index publishers license, and an npm capture saves the published readme. Each has its own egress disclosure naming its exact host.
- A **Reddit** research provider through the companion. Reddit no longer answers anonymous clients, so this needs a free Reddit app of your own: set `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` before launching the companion. The credential never leaves the companion process, an unconfigured companion simply skips the provider, and posts marked over 18 are left out. A self post is captured as its own text; a link post is captured as an honest reference.
- **Export this topic** writes one topic's files as a portable ZIP. It is a copy to keep or read elsewhere, not a workspace archive Dusori can import back, and both the button and a note inside the archive say so.
- Insights now reports **what the review queue is holding**: how many topics are overdue, how many are due today, how many carry a schedule at all, and a bounded histogram of what falls due over the coming days. Derived on read like everything else there — no stored index, no estimated study time, no mastery claim.
- Workspace health can now **create the page an unresolved wikilink already names**, at the exact name the link uses, so the link resolves afterwards. This only ever adds a file that does not exist yet; Markdown you already wrote is never rewritten without your explicit acceptance. The new file records which document linked to it, and the action is appended to the topic's dated update log.
- Two more review prompt kinds. A **cloze** hides the longest word of a source's own opening sentence — nothing is invented, and the excerpt still shows the answer when you ask. A **locate** prompt asks which of your sources covers a section, and appears once a topic has a second source to tell apart. Sessions still run three to five prompts, open with explain and close with compare, and name a source title, section, and workspace path on every prompt.
- **PDF sources.** Choose a `.pdf` and Dusori reads its text on your device; the file never leaves it. The extracted text becomes an ordinary local source, hashed and logged like any other, and is searchable, linkable, and usable in review prompts. A scanned PDF with no text layer says exactly that instead of saving an empty source — Dusori ships no OCR. The PDF reader is fetched only the first time you import one, so the offline app shell does not grow for sessions that never use it.
- A **learning preferences editor** for each topic's `TUTOR.md`: set the depth, then add, remove, or reorder preferences. Dusori shows a diff and writes only when you accept it, through the same protocol `roadmap.md` uses, so an edit made outside Dusori becomes a sibling proposal instead of being overwritten. Only the depth line and the bullet list are rewritten — any prose, extra frontmatter, or heading you added stays as you wrote it.
- With the companion, a configured AI provider, and its own separate consent, a model can propose those preferences instead. It sends the topic title, the current preferences, and the change you type — no note, source, or other file. Its reply is re-read and re-rendered onto your file, so it can change the depth and the bullets and nothing else, an unusable reply changes nothing, and the proposal still reaches you as a diff naming the model.

### Fixed

- The preview server had no MIME type for `.mjs`, so a bundled worker was served as `application/octet-stream` and browsers refused to run it. PDF import could not have worked from a local build before this.

### Accessibility

- Every scrollable panel is now reachable by keyboard (WCAG 2.1.1): the note and roadmap proposal diffs, the fetched-source and research capture previews, and rendered Markdown code blocks each take focus, carry a name, and show a focus ring. Previously a keyboard or screen-reader user could not scroll them at all. Because rendered code blocks arrive as sanitized HTML, they are annotated in the Markdown pipeline after sanitizing, so a note cannot supply those attributes itself. The accessibility end-to-end checks now feed each of these panels content longer than its own height, since the underlying rule only reports a region once it truly overflows.

## [0.5.0] - 2026-07-22

### Added

- Optional spaced review on the **Review next** queue: marking a topic reviewed ("Got it" / "Needs work") schedules its next due date from a fixed 1–60 day interval ladder, stored in a new machine-owned `Topics/<slug>/review.json`. Due topics rise to the top of the queue, scheduled topics rest until due, and topics never marked reviewed keep the existing deterministic order. Review actions append to the dated update log, so they appear in recent activity and the seven-day recap.
- A cross-platform local runner: `npm run setup` and `npm start` build and launch Dusori from a clone on macOS, Windows, and Linux without a manual pnpm bootstrap.

### Safety and portability

- The review schedule is derived from the device's local calendar day, so a one-day interval means the next local day rather than the next UTC boundary.
- `review.json` is machine-owned, schema-versioned, and written under the same expected-hash guard as every other machine file; a conflicting write re-reads the current schedule and reapplies the outcome instead of overwriting it. Older builds ignore the file, ZIP export and import carry it through untouched, and deleting it only forgets the schedule.
- Scheduling stays explicit: no calendar entry, notification, background task, or closed-app work is created.

## [0.4.0] - 2026-07-21

### Added

- Create and edit portable Markdown study notes inside Dusori, using the existing proposal-and-explicit-acceptance protocol when another editor changes a file first.
- Local full-text search across Markdown and text files, with case- and accent-insensitive matching, source titles from manifests, bounded snippets, and no persisted index or network request.
- Backlinks derived from resolved wikilink edges plus an explicit, non-mutating workspace health check for unresolved links, invalid or missing source manifests, missing tracked sources, and untracked source files.
- Deterministic **Review next** ordering and a bounded seven-day workspace recap derived from topic state, roadmaps, and dated update files; no deadlines or background schedule are generated.
- Companion package metadata, `--help` / `--version`, packed-tarball smoke verification, and a provenance-ready manual npm publish workflow.

### Changed

- ZIP imports are fully validated in memory before confirmation and replacement; if a storage write fails, Dusori restores the previous workspace snapshot.
- Import confirmation now names the incoming workspace and reports topic and file counts.
- Generated roadmap, conflict, accepted-update, note, and source log wikilinks resolve correctly from nested dated update folders.

### Safety and portability

- Search, backlinks, health, review ordering, and recap remain read-only local projections; none creates a database, index, schedule, or hidden summary file.
- Workspace health never quarantines or repairs an invalid manifest implicitly. It reports the exact file and leaves recovery to the user.
- The public companion command is `npx @udhawan97/dusori@0.4.0 --root /path/to/Dusori`; the loopback, per-run token, root confinement, and terminal-lifetime boundaries are unchanged.

## [0.3.0] - 2026-07-21

### Added

- Companion research service: `/api/research/fetch` turns a user-confirmed URL into readable text with SSRF guards (blocked-address checks against private, reserved, and other non-public ranges on every redirect hop, a 3-hop cap, HTML/plain-text only, a 4 MiB fetch cap, and a 15 s timeout), and `/api/research/mslearn-search` proxies Microsoft Learn's ranked search.
- **Fetch full content** action on URL sources when the app runs through the companion: per-fetch confirmation naming the exact host, exact-content preview, conflict-safe replacement, and an update-log entry.
- Research panel uses ranked Microsoft Learn results through the companion when available, falling back silently to local catalog scoring.

### Changed

- Companion launch credentials are consumed into memory and immediately removed from the address and current history entry without dropping normal topic or view parameters.
- Connection status now requires a versioned Dusori companion health contract; an unrelated loopback server returning HTML or wrong-service JSON is no longer shown as connected.
- Source, research, and Obsidian guide dialogs now use the browser's modal top layer, contain forward and reverse keyboard focus, close once on Escape, and restore focus to their invoker.

### Safety and portability

- Source provenance (`origin.provider`, `origin.capturedVia`) widened to tolerant strings so future values never break a reader; upgraded sources record `companion` / `page-extract` provenance and keep their URL-hash identity.
- **Compatibility:** v0.2.0 can rename `Sources/manifest.json` after reading the newer `companion` provenance value. Source content is untouched, but users should update before reopening an upgraded workspace; if the rename already happened, update and rename the `.invalid-<timestamp>` manifest back.

## [0.2.0] - 2026-07-21

### Added

- Consent-gated, objective-led research using the keyless Microsoft Learn catalog and English Wikipedia APIs.
- Deterministically ranked suggestions with sanitized snippets, exact source previews, persistent dismissal, and normal source-library acceptance.

### Changed

- Scale the browser-local knowledge constellation to workspace size and order topics by wikilink affinity, with deterministic geometry audits that prevent node collisions and clipping.
- Mark wikilink hubs with marigold rings and let pointer and keyboard users focus a node, dim unrelated artifacts, and open the selection directly.
- Refine the public Dusori identity with the supplied ensō, rangoli, and katana geometry plus reduced-motion-aware animation.

### Safety and portability

- Accepted research captures remain URL sources, deduplicate by URL, record provider origin, append the topic update log, and appear in the portable graph.
- Provider consent stays on the device; all network access uses injected browser fetch, and the offline service worker ignores cross-origin API responses.
- Topic `research.json` files use schema validation and hash-guarded writes so concurrent dismissals are merged instead of silently lost.

## [0.1.0] - 2026-07-20

### Added

- Free, accountless browser workspace backed by origin-private storage, with ZIP import and export.
- User-approved folder access on supported Chromium browsers, including a least-privilege Obsidian setup flow.
- Portable Markdown and JSON topic structure with sanitized Markdown and strict Mermaid rendering.
- Today and Roadmap views with checkable progress, explicit topic status, and dated update history.
- Local source capture and preview-first curriculum import.
- Portable knowledge graph built from topic containment and Obsidian-style `[[wikilinks]]`.
- Installable offline PWA with a dark-first Japanese and Indian visual identity.
- Optional loopback-only, token-protected local companion foundation.

### Safety and portability

- External Markdown edits stay active; conflicting Dusori writes become explicit dated proposals.
- No account, telemetry, hosted application backend, graph database, paid service, plugin, or AI model is required.

### Known limitations

- Direct folder access requires a supported Chromium browser; other browsers use ZIP portability.
- Remote fetching, PDF extraction, search, Ollama transformations, generated schedules, and unattended work are not implemented.
- The optional companion is versioned in the repository but is not published to npm in this release.

[Unreleased]: https://github.com/udhawan97/Dusori/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/udhawan97/Dusori/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/udhawan97/Dusori/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/udhawan97/Dusori/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/udhawan97/Dusori/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/udhawan97/Dusori/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/udhawan97/Dusori/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/udhawan97/Dusori/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/udhawan97/Dusori/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/udhawan97/Dusori/releases/tag/v0.1.0
