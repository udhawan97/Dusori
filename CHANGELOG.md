# Changelog

All notable Dusori changes are documented here. Dusori follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Consent-gated, objective-led research using the keyless Microsoft Learn catalog and English Wikipedia APIs.
- Deterministically ranked suggestions with sanitized snippets, exact source previews, persistent dismissal, and normal source-library acceptance.

### Changed

- Scale the browser-local knowledge constellation to workspace size and order topics by wikilink affinity, with deterministic geometry audits that prevent node collisions and clipping.
- Mark wikilink hubs with marigold rings and let pointer and keyboard users focus a node, dim unrelated artifacts, and open the selection directly.

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

[0.1.0]: https://github.com/udhawan97/Dusori/releases/tag/v0.1.0
