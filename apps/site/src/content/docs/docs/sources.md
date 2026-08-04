---
title: Sources and research
description: Ask one question, keep an honest research trail, and read or remove the sources Dusori finds.
---

Dusori’s main job is research. Open **Research**, ask a question in ordinary language, and choose which providers may receive it. Dusori then searches, ranks, saves a varied shortlist of up to five sources, reads the text it can obtain legitimately, and builds a source-backed brief. There is no roadmap or quiz prerequisite.

## One question, one research run

1. Create or open a topic.
2. Open **Research** and enter the question you actually want answered.
3. On the first run, select the providers you permit. Every decision is stored separately on this device and can be reset in Settings.
4. Choose **Research topic**.
5. Watch the source list move through Saved, Read, Reference, or Needs browser. When quotable text is available, Dusori opens `Synthesis.md` as the brief.

The latest query and every provider outcome survive reload. `found`, `empty`, and `failed` are different states: a provider outage is never rewritten as “nothing matched,” and an old brief is not presented as the answer to a new zero-result query.

## What gets saved

The ranked shortlist is added to **Sources** automatically. Each record retains the URL, provider, capture method, ranking reasons, and reported publisher, author, or date when available.

- **Readable evidence** contains an abstract, extract, README, pasted text, or local file that Dusori can quote.
- **Reference** preserves the title and browser URL when the page text was unavailable.
- **Needs browser** records a durable failure such as HTTP 401, 403, or 429.

A reference never supports a synthesis claim until readable text is saved. Optional AI remains separately consented and is not required for deterministic ranking, quoted passages, or synthesis structure.

## Read a page or use the browser

With the local companion connected, **Read from _host_** makes one guarded full-page attempt. Dusori resolves and validates every address, pins the approved public address for the request, revalidates same-origin redirects, caps the response at 4 MiB, and saves readable text directly when successful.

If a site blocks automated reading, Dusori keeps the reference and the exact failure. **Open original** hands an HTTP(S) link to the ordinary browser, including from the desktop app. You can also paste text you are allowed to use. Dusori does not bypass authentication, paywalls, robots controls, or access restrictions.

Manually added URL references are not fetched automatically. Consented research providers may return and save readable abstracts, extracts, or READMEs as part of their documented search API.

## Remove and restore

Choose **Remove from research** to stop a source from contributing to counts, Map, quoted passages, and future briefs. Its local item is retained in a tombstone so **Restore** still works after a relaunch. Removed items do not appear as stray or untracked source files in workspace health.

## Add your own material

- **Pasted text:** a readable local `.txt` source.
- **Markdown or text file:** `.md`, `.markdown`, or `.txt`, normalized for portable line endings.
- **PDF:** text extracted on the device. The original is not copied or uploaded. A scan with no text layer is reported; Dusori ships no OCR.
- **URL reference:** a local Markdown reference containing an `http://` or `https://` URL.

Saved source text is bounded to 2 MiB. URLs with embedded usernames or passwords are rejected.

## Research providers

Seven keyless public providers work without the companion: Microsoft Learn, English Wikipedia, Hacker News, GitHub, Stack Overflow, OpenAlex, and npm. Broad questions avoid specialist developer catalogs unless their terms are relevant. Allowed providers run together, and one timeout does not discard another provider’s useful results.

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
