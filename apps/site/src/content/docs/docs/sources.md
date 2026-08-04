---
title: Sources and research
description: Find, preview, deliberately save, and read evidence without losing its provenance.
---

**Sources** is the evidence shelf for the current topic. Its count comes from `Sources/manifest.json`. A research result is not on the shelf until you explicitly save it.

## Candidate → saved source → reading copy

1. From **Learn**, choose **Find sources**.
2. Select a research angle or roadmap objective.
3. Allow one or more providers after reading each disclosure.
4. Choose **Preview** to inspect a candidate. Preview changes no workspace file and does not change the Sources count.
5. Choose **Save source** to add it to the shelf, or **Save & read** to add it and open the Reading room.
6. Return to **Sources** at any time to see everything deliberately kept for this topic.

Saving retains the URL, provider, capture method, ranking reasons, and reported publisher, author, or date when available. **Dismiss** records the candidate key so it stays out of later results.

## Add your own material

- **Pasted text:** a readable local `.txt` source.
- **Markdown or text file:** `.md`, `.markdown`, or `.txt`, normalized for portable line endings.
- **PDF:** text extracted on the device. The original is not copied into the workspace or uploaded. A scanned PDF with no text layer is reported; Dusori ships no OCR.
- **URL reference:** a small Markdown file containing an `http://` or `https://` URL. The page is not fetched.

Imports are bounded to 2 MiB of saved source text. URLs with embedded usernames or passwords are rejected. Opening an original URL is an explicit browser navigation to that site.

## Research behavior

Seven keyless public providers work without the companion: Microsoft Learn, English Wikipedia, Hacker News, GitHub, Stack Overflow, OpenAlex, and npm. Allowed providers run together. A timeout or failure from one does not discard another provider’s useful result.

Candidates are ranked deterministically using query relevance, provider-relative public signals, recency, and a bounded host signal. Dusori shows the reasons and selects a diverse shortlist. Optional AI may advise the order only under separate consent; failure keeps deterministic order.

The research trail stores up to fifty recent runs in `research.json`, including:

- the exact query text sent;
- the selected angle;
- the number of new candidates;
- one outcome per provider: `found`, `empty`, or `failed`, with the provider’s error message.

A run where every provider fails stays recorded as a failed run. It never becomes “nothing matched.”

## Keep a topic fresh

**Keep this topic fresh** grants standing permission to re-scan only when you open that topic after seven days, using only providers already allowed. It does not run on first visit, more than once per session, while the app is closed, or in the background.

## Read, synthesize, and review

**Read saved sources** extracts up to twelve verbatim passages per readable source, tagged with their headings. A bare URL reference reports that its text is unavailable rather than disappearing from the count.

**Build synthesis** writes `Synthesis.md` from those passages. Quotations link to their local source, single-source claims are marked thin, and coverage gaps remain visible. Rebuilding an externally edited synthesis creates a proposal instead of overwriting it.

**Create learning page** writes a self-contained `Learning/learn.html` with cited concepts and reveal-style prompts. It makes no network requests, keeps no score, works offline, and can open outside Dusori. The in-app copy runs in a sandbox without access to workspace storage or cookies.

Source-grounded review uses readable saved text. Starting or abandoning a review writes nothing. Typed answers remain in the session unless saved as a note; only **Got it** or **Needs work** changes the review schedule.

## Fetch an exact page through the companion

A URL reference stays unfetched by default. With the local companion, choose **Fetch full content**. Dusori names the exact host before the request, validates each redirect against private and reserved address ranges, caps the response at 4 MiB, extracts readable text, and previews the exact replacement. **Replace content** performs the guarded write; an external edit causes a conflict instead.

## Companion providers

- arXiv works through the companion without a key.
- Configure one general web provider with `SEARXNG_URL`, `BRAVE_API_KEY`, or `TAVILY_API_KEY`; set `RESEARCH_WEB_SEARCH=brave|tavily|searxng` when more than one is present.
- Reddit requires `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` for an app you registered. Over-18 posts are excluded; link posts remain references.
- YouTube discovery prefers the official Data API v3 with your `YOUTUBE_API_KEY`. You may optionally set a self-hosted `INVIDIOUS_URL` as a fallback; Dusori ships no default instance. Both routes search metadata and proxy the thumbnail. A saved video remains a reference; Dusori does **not** harvest captions or download media. Add transcript text through Paste or File only when you supplied it, own it, or have permission.
- Optional `OLLAMA_MODEL`, `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY` enables separately consented, model-labeled assistance.

See the [provider and legal matrix](../research-providers/) before configuring third-party services.

## Topic file contract

```text
Topics/<topic-slug>/
├── Sources/
│   ├── manifest.json
│   └── items/<hash>-<portable-title>.md|txt
├── research.json
├── Synthesis.md
├── Learning/learn.html
└── Updates/YYYY/MM/YYYY-MM-DD.md
```

These files travel in workspace exports. Markdown and text are user-readable; JSON is machine-owned, schema-versioned, bounded, and validated. Compatible unknown data from newer workspaces is preserved across supported edits.
