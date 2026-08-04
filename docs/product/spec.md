# Dusori product specification

**Status:** v0.12.3 release contract · **Date:** 2026-08-04

## Product promise

Dusori is a free, open-source, local-first research desk for certifications and general topics. It helps a researcher ask a question, find permitted sources, keep and read evidence, build a cited brief, and inspect the resulting knowledge map. Optional study tools remain available without defining the primary workflow.

The governing research sequence is:

```text
Ask → Search allowed providers → Save shortlist → Read available evidence → Brief → Map/Outline
```

Dusori has no hosted account, workspace database, analytics, telemetry, or paid core dependency. Its deterministic baseline works without AI.

## Information architecture

The app has four stable primary destinations:

1. **Research** — one plain-language question to provider outcomes, a saved shortlist, and a cited brief.
2. **Sources** — the current topic’s evidence shelf and Reading room, with provenance and readable/reference states.
3. **Map** — an explorable galaxy and accessible linear Outline derived from the same files.
4. **Settings** — appearance, storage, privacy, companion status, export/import, desktop updates, and optional learning tools.

The topic-aware destinations never claim that the researcher has made progress. Objectives, reviews, roadmaps, insights, and official-outline import live under **Settings → Optional learning tools** and never gate research.

## Non-negotiable state semantics

- A research run saves up to five ranked results to the manifest-backed shelf automatically.
- Provider-returned abstracts, extracts, and READMEs may be saved after provider consent; arbitrary result pages are never fetched automatically.
- A URL reference cannot support a claim until readable text exists.
- Opening a topic, source, map, or review does not change learning progress.
- A roadmap objective changes only through an explicit checkbox action.
- Topic **Active**, **Paused**, and **Complete** state is separate from roadmap completion.
- Only **Got it** or **Needs work** updates the review schedule.
- No score, streak, inferred study time, or mastery claim is produced.

## Portable storage contract

Browser-managed storage, supported real-folder storage, Tauri storage, and ZIP archives share one logical tree:

```text
<Dusori Root>/
├── Home.md
├── dusori.json
└── Topics/<topic-slug>/
    ├── Overview.md
    ├── roadmap.md
    ├── Synthesis.md
    ├── TUTOR.md
    ├── state.json
    ├── research.json
    ├── review.json
    ├── proposals.json
    ├── Learning/learn.html
    ├── Notes/
    ├── Sources/
    │   ├── manifest.json
    │   └── items/
    ├── Updates/YYYY/MM/YYYY-MM-DD.md
    └── Backups/
```

Markdown and text are user-owned. Machine-owned JSON is schema-versioned, bounded, and validated. Compatible unknown keys survive supported reads and mutations so an older writer does not silently downgrade newer data.

Existing tracked Markdown requires an expected hash. If another editor changed it, the external version remains active and Dusori writes a sibling proposal plus a durable lifecycle record. Import preflight validates structure, paths, counts, compressed/expanded size, and schemas before the first destination write. Replacement writes complete staged and backup copies before removing a live file; rollback restores the previous snapshot, and a persistent rollback failure leaves the untouched backup under `.dusori-import-recovery/backup`.

## Sources and research

Supported source paths are pasted text, local Markdown/text, locally extracted PDF text, URL reference, and explicitly saved research candidate. A PDF never leaves the device; no OCR is included. URL references are not fetched by the hosted app.

Seven keyless providers run from browser or desktop app after consent: Microsoft Learn, Wikipedia, Hacker News, GitHub, Stack Overflow, OpenAlex, and npm. The companion can add arXiv, configured Reddit, configured general web search, configured YouTube metadata, and optional AI.

Every provider has:

- a stable identifier and plain label;
- a disclosure naming the remote host and data sent;
- an availability/configuration state;
- a distinct per-run `found`, `empty`, or `failed` outcome;
- a bounded capture policy and provenance record.

Availability never substitutes for a run outcome. `research.json` retains the fifty most recent trails, their exact queries, angles, new-result counts, and provider outcomes.

The companion fetches an exact URL only after host confirmation. Each address and redirect is checked against private/reserved ranges, redirects and time are capped, response size is capped at 4 MiB, and the extracted replacement is previewed before a guarded write.

YouTube discovery prefers the official Data API v3 through an operator-supplied `YOUTUBE_API_KEY`. An optional self-hosted `INVIDIOUS_URL` is the fallback when the key is absent or the official request is unavailable. Both paths are limited to metadata search and thumbnail proxy; saved results are references. Dusori does not download video, audio, or captions. Transcript text enters only through Paste/File when the learner supplied it, owns it, or has permission.

## Reading, synthesis, and learning page

Reading saved sources extracts at most twelve verbatim passages per readable source with heading context. An unreadable reference is reported, not silently treated as evidence.

`Synthesis.md` groups cited passages, marks single-source support as thin, builds a dated timeline when evidence permits, and names open questions and missing lenses. Rebuilds use the proposal protocol. Optional AI may write only a model-labeled overview under a separate disclosure; the evidence table and citation structure remain deterministic.

`Learning/learn.html` is self-contained, offline, network-free, scoreless, and portable. In-app display uses a sandbox that permits the page’s own script but denies the app origin, workspace storage, and cookies.

## Learning and review

Continue excludes complete topics and orders due source-ready reviews first, then active topics, then paused topics with stable file-derived tie-breakers. It routes to the owner of the next action without mutating state.

Review sessions contain three to five prompts from the current roadmap objective and readable saved evidence. Prompts name their source and hide a bounded excerpt until asked. Navigation and abandonment write nothing. Answers remain ephemeral unless explicitly saved as a Markdown note. Review outcomes use the fixed 1, 3, 7, 14, 30, then 60 day ladder in `review.json`.

A per-topic freshness preference may re-scan when the topic is opened after seven days, only with already consented providers and at most once per session. Nothing researches or schedules while the app is closed.

## Map and evidence

Galaxy and Outline use the same graph derived from topic containment and resolved `[[wikilinks]]`. Backlinks reverse resolved edges; tags are read from ordinary Markdown. Coordinates, zoom, filters, and health state are not persisted in the workspace.

Learning evidence derives activity, objective progress, artifact mix, link health, provenance, hubs, tags, topic depth, and review pressure. It persists no analytics index and claims no mastery.

## Companion security contract

The companion binds to random-port loopback and creates a fresh credential per run. The credential never appears in the opened URL, stdout, or logs. The bundled app receives an HttpOnly, SameSite same-origin cookie; desktop API-only mode requires the token through the environment and permits the exact desktop origin. API requests require that cookie or Authorization bearer. File operations remain confined to the explicitly approved root.

## Desktop and updater contract

Tauri builds target macOS Apple silicon and Windows x64, each with a target-native Node.js 24 runtime and companion sidecar. Intel Macs are not supported.

The updater has four explicit operations:

1. Check the fixed GitHub Releases `latest.json` endpoint.
2. Download a platform artifact and verify its updater signature.
3. Install only when the learner confirms and no work is unsaved.
4. Relaunch only after installation was explicitly requested.

Automatic-update opt-in covers checks and downloads only and runs from application startup, even if Settings is never opened. Release CI builds from the matching version tag, requires protected signing material, cryptographically verifies both platform signatures, and stages an exact-asset draft with `latest.json` plus `SHA256SUMS.txt`. Publication is a separate, post-download verification step.

v0.12.3 OS installers are not Apple-notarized or Microsoft code-signed. Documentation must keep that warning separate from the valid in-app updater signature.

## Explicitly not built

- Accounts, hosted sync, telemetry, or hosted workspace storage
- Closed-app research, notifications, or background review scheduling
- Unattended update installation or restart
- OCR for image-only documents
- Social-feed scraping, access-control bypass, or YouTube media/caption download
- Single-topic merge import into an existing workspace
- Arbitrary AI chat that edits workspace files
- Apple notarization or Microsoft Authenticode signing for v0.12.3

## Trust model

Grounded generation is not a guarantee. Source text is untrusted data, not executable instruction. Network egress must be disclosed before it happens. Generated content must be labeled, provenance must remain inspectable, deterministic fallback must remain useful, and user-authored files must never be silently replaced.
