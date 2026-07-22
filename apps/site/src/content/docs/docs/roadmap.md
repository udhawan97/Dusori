---
title: Roadmap
description: Planned work is separated explicitly from what Dusori ships today.
---

## Shipped in the current build

- Browser workspace in origin-private storage
- Direct folder connection on supported Chromium desktop browsers
- Canonical Markdown/JSON topic structure
- Validated ZIP import with rollback-safe browser-workspace replacement, plus ZIP export
- Conflict-safe proposals and dated update logs
- Local source library for pasted text, Markdown/text files, and unfetched URL references
- Consent-gated Microsoft Learn catalog and English Wikipedia research with preview-first source capture
- Preview-first curriculum import for English Microsoft Learn study guides and structured Markdown syllabi
- In-app creation and conflict-safe editing of portable Markdown notes
- Local full-text workspace search with no stored index or remote query
- Backlinks and non-mutating workspace health for wikilinks and source manifests/files
- Interactive Markdown roadmap progress, explicit topic status, deterministic review order, and a seven-day recap
- Optional spaced review: an explicit "Got it" / "Needs work" action schedules a topic's next due date on the review queue from a fixed interval ladder
- Sanitized Markdown, wikilinks, and a strict Mermaid rendering path
- Offline application shell
- Loopback-only local companion security foundation
- Companion-only page fetching with readability extraction, confirmed per fetch, and ranked Microsoft Learn search
- Version-aligned, packed-tarball-tested `dusori` companion package and provenance-ready publish workflow

## Planned—not built

- Remote-page fetching from the hosted app alone, without the local companion
- PDF and other non-text document import
- Ollama discovery and source-bounded transformations
- Model capability probes
- Chat-to-`TUTOR.md` diff editing
- Key-based or general-purpose search adapters

There is no commitment to a hosted backend, accounts, telemetry, paid API, or always-running background process.
