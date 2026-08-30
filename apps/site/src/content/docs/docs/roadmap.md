---
title: Product roadmap
description: What v0.15.0 ships and what remains explicitly unbuilt.
---

The product roadmap is not a progress score for the researcher. Inside the app, **Map/Outline** shows what the local research files contain. Optional learning tools live under Settings. This page is the project roadmap.

## Shipped through v0.15.0

- Stable topic-local question-thread identity with optional parent identity for explicit
  follow-ups; legacy runs stay readable without fabricated IDs
- A bounded typed activity trail for questions, lookup receipts, source saves/reads, quoted
  annotations, synthesis writes/proposals, and presentation exports
- Artifact-linked thread activity that labels provider results as discovery history rather than
  evidence
- Markdown, standalone HTML, and user-initiated Print/PDF research packets accompanied by a
  provenance manifest with local content hashes, omitted-path status, and explicit non-round-trip
  semantics
- Explicit local follow/unfollow and a workspace-wide Updates inbox derived from saved activity,
  with no provider request, consent change, or refresh side effect
- Source-linked note/reply events, bounded event compaction, minimal retention/deletion tombstones,
  and visible missing-target states
- Question redaction and thread-ledger deletion that preserve saved artifacts and warn that prior
  archives and presentation packets remain independent copies
- Import validation and exact workspace ZIP round-trip coverage for the additive thread model
- Versioned local quote locators with exact/prefix/suffix context, Unicode-code-point positions,
  normalized-text hashes, and retained PDF page identity; a changed fingerprint fails closed
- Normalized source/note/thread tags and explicit learner-authored typed relations that create views
  and edges without moving or duplicating the underlying files
- Depth-map edge explanations plus direct jumps to stored sources, annotations, events, and artifacts
- Network-inert standalone HTML rendered from the same research packet as Markdown, with a
  print-specific stylesheet for user-initiated Print/PDF
- Additive citation metadata that normalizes already-known DOI, ISBN, arXiv, PMID/PMCID, OpenAlex,
  and Open Library identifiers without network resolution; provider-derived records retain their
  consent scope and packet manifests carry the same bounded provenance
- Local citation-metadata correction for normalized identifiers and an optional journal or
  collection, preserving earlier provenance without resolver calls or evidence-state changes

- Research, Sources, Map, and Settings as four predictable destinations
- One-action provider search that saves a varied shortlist, reads available text, and writes an evidence-backed brief
- Certification intent that survives relaunch, routes Microsoft exam codes to Microsoft Learn, and offers official-outline import
- Visible provider readiness for built-in, web, social, video, and academic research paths
- Optional file-derived learning, explicit roadmap completion, source-grounded reviews, and evidence signals under Settings
- Separate Read, Readable evidence, URL reference, and blocked-page states with durable provenance
- Local Reading room and topic-local question search
- Galaxy plus accessible linear Outline
- Consent-gated research with a durable per-provider outcome trail
- Keyless browser providers plus configured companion providers
- Portable Markdown/text/JSON/HTML workspaces and conflict-safe proposals
- Browser PWA, Node companion, macOS Apple silicon, and Windows x64 release paths
- Signed in-app update artifacts with separate check, download, install, and restart actions
- Native desktop and installer icons derived from the same ensō, rangoli, and katana identity shown in the README
- One search-to-brief transaction with partial-failure and deterministic-fallback interface tests
- One capability-aware provider catalog shared by consent, routing, evidence lenses, and CSP parity tests
- One read-only Today projection and one pure workspace navigation decision module
- Local, fail-closed question routing that never turns an unrelated allowed provider into fallback egress
- Consent-gated Europe PMC abstracts for biomedical questions and Library of Congress references for cultural-heritage questions
- A focused mobile consent sheet with fixed actions, full-catalog visibility, and focus restoration on every close path
- Live operating-system appearance tracking while **System** is selected
- Local source-shelf search with separate Evidence and References lenses
- A previous/next reading trail that keeps shelf position and provenance visible
- Source-grounded Markdown annotations that preserve an exact selected quote, section, source path,
  and content fingerprint
- Fail-closed browser-storage restoration across recorded IndexedDB and OPFS workspaces

## Intentionally not built

- Account, cloud sync, hosted workspace storage, or telemetry
- Closed-app research, background review scheduling, notifications, or unattended installation
- Claims of mastery, inferred study time, streaks, or a proprietary knowledge score
- Scraping authenticated social feeds, bypassing access controls, or downloading YouTube media/captions
- OCR for scanned PDFs
- Single-topic merge import into an existing workspace
- Arbitrary AI chat that edits workspace files
- Apple notarization or Microsoft Authenticode signing for v0.15.0 installers
- Cloud, multi-user, notification, or unread-state delivery for followed research

## Candidates for later releases

- Opt-in encrypted device-to-device sync that preserves file ownership
- More curriculum adapters after each format has stable fixtures and preview-first behavior
- Revision-aware re-anchoring and annotation management beyond the preserved quote and context in
  v0.15.0 notes
- Separately consented citation resolver calls
- Reproducible OS code-signing/notarization when an open, sustainable release path is available
- A recovery UI for invalid machine-owned files that never mutates before showing the proposed repair
- Model- or dataset-catalog providers such as Hugging Face until a concrete, consentable workflow has stable fixtures and honest evidence boundaries

Candidates are not commitments. A feature becomes shipped only after its behavior, privacy boundary, documentation, tests, and release artifact are verified together.
