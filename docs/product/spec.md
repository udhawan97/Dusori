# Dusori product specification

**Status:** web-research Phase 1 and Phase 2 (companion research service) implementation · **Date:** 2026-07-21

## Product contract

Dusori is a free, open-source, local-first learning workspace with a deterministic baseline that works without AI. Users may keep a workspace inside browser-managed storage or, on supported platforms, grant access to one local folder. The same portable Markdown/JSON structure is used in both modes.

The application has no hosted backend, account system, telemetry, analytics, or paid core dependency. Obsidian compatibility means writing ordinary Markdown and wikilinks inside a user-selected `<Vault>/Dusori/` folder; Obsidian itself and plugins are optional.

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

The shipped source library accepts pasted text, local `.md`/`.markdown`/`.txt` files up to 2 MiB, and `http://` or `https://` URL references. URL capture stores the reference without fetching remote content. Every new source is hashed, recorded in the topic manifest, and appended to the dated update log.

The shipped curriculum importer accepts pasted Microsoft Learn study-guide Markdown with the English `Skills measured` hierarchy and general structured Markdown syllabi. It extracts at most 200 objectives locally, previews them before writing, preserves the original outline as a topic source, and updates `roadmap.md` through the same conflict-safe acceptance protocol. The optional official URL is provenance metadata only and is never fetched.

The shipped learning loop parses ordinary Markdown task syntax from `roadmap.md`. Users can complete or reopen an objective, set a topic to active, paused, or complete, and review a deterministic **Today** summary of progress, next steps, and recent dated updates. Roadmap writes use the existing hash guard; an external edit produces a sibling proposal and requires explicit review. No schedule or recap is generated.

The shipped Research panel starts from a selected roadmap objective and defaults to the next unchecked item. Searching Microsoft Learn downloads its public module catalog and ranks modules locally; an accepted module remains honestly labeled as a catalog reference, not a page snapshot. Wikipedia provides ranked English search plus a plain-text page extract, truncated when necessary to stay inside the 2 MiB source limit. Both providers are keyless and browser-callable.

The first search with each provider is blocked behind an exact egress disclosure naming the provider host and the objective text being sent. Consent is stored per provider on the device. Accepted captures reuse the normal URL-source path, keep `method: "url"`, deduplicate by URL, record capture origin, append the dated update log, and remain ordinary portable Markdown. Dismissed suggestions are kept in the topic's machine-owned `research.json` file.

With the local companion running, Microsoft Learn search instead proxies Microsoft's own ranked search API, falling back silently to local catalog ranking if that call fails. A URL source can also be upgraded to the page's readable text after a per-fetch confirmation that names the exact host; the companion validates every address—including each redirect hop—against private, reserved, and other non-public ranges, follows at most three re-validated redirects, and caps pages at 4 MiB.

## Explicitly not built yet

- Arbitrary web search providers or API-key integrations
- PDF or non-text curriculum extraction
- Ollama or other model operations
- AI-generated notes or diagrams
- Chat-to-`TUTOR.md` editing
- Generated schedules, recaps, or closed-app work
- Accounts, sync, telemetry, or hosted storage

## Trust model

Grounded generation is not a guarantee against unsupported output. Future AI behavior must keep source provenance visible, mark generated content, show diffs before replacing user-visible text, sanitize all output, and retain the deterministic scaffold as a fallback.

Source text is untrusted data—not executable instructions. Remote egress must be disclosed before any content is sent to an explicitly selected provider.

## Storage ownership

- Markdown is user-owned.
- JSON is machine-owned, schema-versioned, and validated.
- New files may be created automatically.
- Existing Markdown requires explicit acceptance before a matching version is changed.
- A stale version produces a sibling proposal and append-only update entry.
- Migrations create recoverable backups.
- Every operation remains inside the selected Dusori root.

This specification supersedes the earlier Python/FastAPI/pipx delivery architecture, keyless DuckDuckGo dependency, parameter-count model tiers, and the claim that an LLM “never invents.”
