---
title: Roadmap
description: Planned work is separated explicitly from what Dusori ships today.
---

## Shipped in the current build

- Browser workspace in origin-private storage
- Direct folder connection on supported Chromium desktop browsers
- Canonical Markdown/JSON topic structure
- Validated ZIP import with rollback-safe browser-workspace replacement, plus ZIP export of the whole workspace or one topic
- Conflict-safe proposals, a durable topic-local proposal lifecycle, and dated update logs
- Local source library for pasted text, Markdown/text files, PDFs read on your device, and unfetched URL references
- Automatic, consent-gated research across Microsoft Learn, English Wikipedia, Hacker News, GitHub, Stack Exchange, OpenAlex, and the npm registry, with explainable deterministic ranking and preview-first source capture
- Tags read from your own Markdown — `tags:` frontmatter or an inline `#tag` — with a `tag:` search filter, a graph filter, and a tag count in Insights
- Preview-first curriculum import for English Microsoft Learn study guides, AWS Certification exam guides, and structured Markdown syllabi, from pasted text or from an AWS exam guide PDF read on your device
- In-app creation and conflict-safe editing of portable Markdown notes
- Local full-text workspace search with no stored index or remote query
- Backlinks and non-mutating workspace health for wikilinks and source manifests/files
- Evidence-driven Today lanes for workspace-wide continuation and proven attention, plus interactive Markdown roadmap progress, explicit topic status, and a seven-day recap
- Optional spaced review: an explicit "Got it" / "Needs work" action schedules a topic's next due date on the review queue from a fixed interval ladder
- Source-grounded review sessions: three to five deterministic active-recall prompts built from a topic's objective and its own readable approved sources, each showing its source path and excerpt on demand, with optional consent-gated AI rewording
- Sanitized Markdown, wikilinks, and a strict Mermaid rendering path
- Offline application shell
- Loopback-only local companion security foundation
- Companion-only page fetching with readability extraction, confirmed per fetch, and ranked Microsoft Learn search
- Companion-backed arXiv, configured Brave, Tavily, or SearXNG web search, and Reddit through a Reddit app credential you supply
- Learning preferences for each topic, edited with the same diff-and-accept protocol as your notes, with optional AI proposals
- Creating the page an unresolved wikilink already names, from workspace health
- Companion-backed YouTube search through a configured Invidious instance, ordered by view count, with caption capture that turns a video into readable text and a thumbnail proxied so the browser never contacts Google
- Optional consent-gated Ollama, Anthropic, or OpenAI ranking and model-named research briefs, with deterministic fallback
- Local Insights for activity, objective progress, artifact mix, link health, topic depth, hubs, provenance, tags, and what the review queue is holding
- Version-aligned, packed-tarball-tested `dusori` companion package and provenance-ready publish workflow

## Planned—not built

- OCR for scanned PDFs and other image-only documents
- Recognizing a curriculum PDF that is not an AWS exam guide, which needs an outline adapter for PDF-native structure rather than Markdown headings
- Importing a single-topic bundle back into an existing workspace
- Scheduled or unattended research and source acceptance
- Inline video playback inside Dusori

## Not planned

- **Remote-page fetching from the hosted app alone.** A browser cannot fetch arbitrary third-party pages, and the only workaround is a proxy — which would be the hosted backend Dusori does not have. The local companion covers this instead.

There is no commitment to a hosted backend, accounts, telemetry, paid API, or always-running background process.
