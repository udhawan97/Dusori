# Dusori product specification

**Status:** workspace-foundation implementation · **Date:** 2026-07-20

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

## Explicitly not built yet

- Automated curriculum or certification extraction
- Web search
- Source fetching
- Ollama or other model operations
- AI-generated notes or diagrams
- Chat-to-`TUTOR.md` editing
- Closed-app or unattended scheduling
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
