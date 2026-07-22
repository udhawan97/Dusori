# Changelog

All notable Dusori changes are documented here. Dusori follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Optional spaced review on the **Review next** queue: marking a topic reviewed ("Got it" / "Needs work") schedules its next due date from a fixed 1–60 day interval ladder, stored in a new machine-owned `Topics/<slug>/review.json`. Due topics rise to the top of the queue, scheduled topics rest until due, and topics never marked reviewed keep the existing deterministic order. Review actions append to the dated update log, so they appear in recent activity and the seven-day recap.

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

[Unreleased]: https://github.com/udhawan97/Dusori/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/udhawan97/Dusori/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/udhawan97/Dusori/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/udhawan97/Dusori/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/udhawan97/Dusori/releases/tag/v0.1.0
