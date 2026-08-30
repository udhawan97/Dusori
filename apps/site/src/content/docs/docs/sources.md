---
title: Sources and research
description: Ask one question, keep an honest research trail, and read or remove the sources Dusori finds.
---

Dusori’s main job is research. Open **Research** and ask a question in ordinary language. Dusori routes that question locally, asks which relevant providers may receive it, searches only the allowed intersection, removes duplicate URLs, DOIs, and conservative scholarly-title matches, ranks and saves a varied first shelf of up to eight sources, reads the text it can obtain legitimately, and builds a source-backed brief. Further ranked results remain available for individual review and approval. There is no roadmap or quiz prerequisite.

## One question, one research run

1. Create or open a topic.
2. Open **Research** and enter the question you actually want answered.
3. On the first run, review the focused list routed for this question and select the providers you permit. The full catalog and every decision remain visible; decisions are stored separately on this device and can be reset in Settings.
4. Choose **Research topic**.
5. Watch the source list move through Saved, Read, Reference, or Needs browser. Expand **more results** to review the remainder and choose **Approve and add** for any extra source you want. When extra results await review, **Open brief** takes you to the ready `Synthesis.md`; otherwise Dusori opens it immediately.

The latest query and every provider outcome survive reload. `found`, `empty`, and `failed` are different states: a provider outage is never rewritten as “nothing matched,” and an old brief is not presented as the answer to a new zero-result query.

## What gets saved

The ranked first shelf is added to **Sources** automatically. Further ranked results are not saved until you approve them individually. Every saved record retains the URL, provider, capture method, ranking reasons, and reported publisher, author, or date when available.

- **Readable evidence** contains an abstract, extract, README, pasted text, or local file that Dusori can quote.
- **Reference** preserves the title and browser URL when the page text was unavailable.
- **Needs browser** records a durable failure such as HTTP 401, 403, or 429.

A reference never supports a synthesis claim until readable text is saved. Optional AI remains separately consented and is not required for deterministic ranking, quoted passages, or synthesis structure.

## Read a page or use the browser

With the local companion connected, **Read from _host_** makes one guarded full-page attempt. Dusori resolves and validates every address, pins the approved public address for the request, revalidates same-origin redirects, caps the response at 4 MiB, and saves readable text directly when successful.

If a site blocks automated reading, Dusori keeps the reference and the exact failure. **Open original** hands an HTTP(S) link to the ordinary browser, including from the desktop app. You can also paste text you are allowed to use. Dusori does not bypass authentication, paywalls, robots controls, or access restrictions.

Manually added URL references are not fetched automatically. Consented research providers may return and save readable abstracts, extracts, or READMEs as part of their documented search API.

## Find, read, and annotate saved evidence

The Sources shelf searches locally across source titles, publishers, providers, authors, original
filenames, and URL hosts. **Evidence** shows local text Dusori can read; **References** shows saved
URLs that still need readable text. The search and filter are temporary views: they do not write an
index, preference, or completion state.

Open any local reading copy to enter the Reading room. Previous and next controls follow the active
source-manifest order and keep the shelf position, evidence state, and provenance in view. Select a
passage before choosing **Quote selection in a note** to create a learner-owned Markdown note that
keeps:

- the exact selected words;
- the nearest section heading, when one exists;
- the local source path; and
- the reading copy's current content SHA-256;
- a versioned normalized-content SHA-256 plus bounded exact/prefix/suffix context; and
- Unicode-code-point start/end positions and retained PDF page identity when the local format can
  supply them.

Position is checked first only while both local fingerprints agree. Context is a fallback for the
same fingerprint. If the file changes or a match is ambiguous, Dusori retains the original quote and
fails closed instead of silently re-anchoring against a live page.

Choosing **Annotate in a study note** without a selection creates the same source-linked note without
inventing a quote. The source link and captured passage are saved by that explicit action before the
note editor opens. Later source changes never rewrite the saved quote or the learner's commentary.

## Remove and restore

Choose **Remove from research** to stop a source from contributing to counts, Map, quoted passages, and future briefs. Its local item is retained in a tombstone so **Restore** still works after a relaunch. Removed items do not appear as stray or untracked source files in workspace health.

## Add your own material

- **Pasted text:** a readable local `.txt` source.
- **Markdown or text file:** `.md`, `.markdown`, or `.txt`, normalized for portable line endings.
- **PDF:** text extracted on the device. The original is not copied or uploaded. A scan with no text layer is reported; Dusori ships no OCR.
- **URL reference:** a local Markdown reference containing an `http://` or `https://` URL.

Optional comma- or space-separated tags are normalized into facets in `manifest.json`. A tag changes
only how Sources and Map can find the record; it never copies or moves the source.

Saved source text is bounded to 2 MiB. URLs with embedded usernames or passwords are rejected.

## Research providers

Eleven keyless public providers work without the companion: Microsoft Learn, English Wikipedia, Hacker News, GitHub, Stack Overflow, Europe PMC, OpenAlex, Library of Congress, Crossref, Open Library, and npm. Europe PMC is routed only for biomedical terms and can save a returned abstract as readable evidence. Library of Congress is routed only for narrow cultural-heritage terms and saves digitized-item catalog records as browser references. Broad questions avoid specialist catalogs unless their terms are relevant. Allowed providers run together, and one timeout does not discard another provider’s useful results.

The companion can add arXiv, configured general web search, Reddit, and YouTube metadata. See the [provider and legal matrix](../research-providers/) for credentials, egress, and limits.

## Topic file contract

```text
Topics/<topic-slug>/
├── Sources/
│   ├── manifest.json
│   └── items/<hash>-<portable-title>.md|txt
├── research.json
├── Synthesis.md
└── Updates/YYYY/MM/YYYY-MM-DD.md
```

These files travel in workspace exports. Markdown and text are user-readable; JSON is machine-owned, schema-versioned, bounded, and validated. An externally edited synthesis is protected by the proposal workflow rather than overwritten.
