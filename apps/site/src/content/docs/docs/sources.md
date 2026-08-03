---
title: Sources
description: Add local material or accept disclosed research without uploading your workspace.
---

Each topic has a local source library. Open **Research**, use the **Approved evidence** bay, choose **Source type**, give the item a title, and select **Add source**.

## Supported source types

- **Pasted text:** stored as a readable `.txt` file.
- **Local file:** `.md`, `.markdown`, `.txt`, and `.pdf` files up to 2 MiB. Markdown stays Markdown; line endings are normalized for portability.
- **PDF:** read on your device by the reader bundled with Dusori and loaded only when you import one. The file is never uploaded or copied into the workspace; its extracted text becomes an ordinary local source. A scanned PDF has no text layer to read, and Dusori says so instead of saving an empty source; there is no OCR.
- **URL reference:** stores the complete `http://` or `https://` address in a small Markdown reference file. Dusori does not fetch or copy the page.
- **Accepted research:** stores a previewed result from an allowed research provider only after explicit acceptance.

URLs containing embedded usernames or passwords are rejected. Opening a saved URL is an explicit browser action and can contact that website.

## Automatic research from a roadmap objective

Creating a topic opens the first-class **Research** workspace and prepares one automatic discovery run for the next unchecked objective. Research begins as soon as at least one provider is allowed. Later runs use **Scan for strong sources**. Each provider is blocked on first use until you accept its host-specific disclosure; consent is stored on this device.

Without the companion, Dusori can query seven keyless public providers: Microsoft Learn, English Wikipedia, Hacker News, GitHub, Stack Exchange, OpenAlex, and the npm registry. Allowed providers are searched together. A failed or slow provider is reported as skipped without discarding useful results from the others. Candidates are deterministically ranked from objective relevance, provider-relative community signals, recency, and a small transparent host-reputation nudge. Dusori selects a diverse top-five shortlist and displays the reasons behind each result.

Results remain suggestions until you choose **Add to sources**. Microsoft Learn captures are labeled as catalog references, not page snapshots. Wikipedia extracts stay below the same 2 MiB source cap and end with `[truncated]` when the full extract would exceed it. Other browser providers preserve the public reference and provider metadata. **Dismiss** records the result key locally so it stays out of later searches.

After approving one or more results, **Write research brief** creates a clearly marked portable note. The deterministic brief groups approved links and explains their ranking signals; it states that Dusori has not read the pages. No discovered item is accepted automatically.

## Full-content upgrades with the companion

URL references stay unfetched by default. When the app is opened through the local companion, each URL source gains a **Fetch full content** action — including a Microsoft Learn catalog reference accepted from Research. A confirmation names the exact host before anything is sent; every redirect is rechecked against private, reserved, and other non-public address ranges; the fetched page is capped at 4 MiB, reduced to readable text, previewed exactly as it will be written, and only replaces the stub when you choose **Replace content**. The preview ends with `[truncated]` if the extracted text would exceed the 2 MiB source limit. If the source file changed outside Dusori since it was last read, Dusori refuses the replacement as a conflict instead of overwriting it silently. The upgrade is recorded in the topic's update log, and the source keeps its URL, title, and place in the graph.

The companion also adds arXiv and can expose one general web-search provider configured before launch:

- `SEARXNG_URL` for a keyless, open-source SearXNG instance
- `BRAVE_API_KEY` for Brave Search
- `TAVILY_API_KEY` for Tavily
- `RESEARCH_WEB_SEARCH=brave|tavily|searxng` when more than one is configured

## Reddit through your own Reddit app

Reddit no longer answers anonymous clients, so this provider needs a free application of your own. Create a "script" app at [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps), then set both values before launching the companion:

- `REDDIT_CLIENT_ID`
- `REDDIT_CLIENT_SECRET`

The credential stays in the companion process and never enters the browser. Without both values the companion reports that Reddit is not configured and the run skips it, exactly as it does for a provider that times out. Posts marked over 18 are left out. A self post is captured as its own text; a link post is captured as a reference that says it has no text of its own.

## YouTube through an Invidious instance

Set `INVIDIOUS_URL` to an [Invidious](https://invidious.io/) instance — self-hosted for a fully private path, or any instance you trust — and the companion adds a **YouTube** provider that orders results by view count.

Dusori never ships a default instance and your browser never contacts YouTube, Google, or `ytimg.com`. The companion is the only thing that talks to your instance: it runs the search, fetches the thumbnail (which the app renders from local bytes), and, when you approve a video, downloads its captions. A captioned video becomes an ordinary readable source — searchable, graphable, and usable by review prompts — with a note saying captions are often machine-generated. A video without captions is stored as a plain reference, because a video with no text is a dead end for everything else Dusori does.

Search credentials never enter the browser. Optional `OLLAMA_MODEL`, `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY` configuration can add advisory AI ranking and a model-named research brief. AI receives only the content named by its separate consent disclosure, and any failure falls back to deterministic ranking or the deterministic brief.

The current v0.9.1 companion is published as [`@udhawan97/dusori`](https://www.npmjs.com/package/@udhawan97/dusori/v/0.9.1). With Node.js 24, run `npx @udhawan97/dusori@latest`; approve one existing folder with `npx @udhawan97/dusori@latest --root "/path/to/Dusori"`, or omit `--root` to keep folder access off. The [v0.9.1 source ZIP](https://github.com/udhawan97/Dusori/archive/refs/tags/v0.9.1.zip) and repository clone remain available through `npm start`. Follow [Getting started](../getting-started/) for the complete setup.

## Topic file contract

```text
Topics/<topic-slug>/
  Sources/
    manifest.json
    items/
      <sha-prefix>-<portable-title>.md|txt
  research.json  # run history, seen results, and dismissals
  Updates/YYYY/MM/YYYY-MM-DD.md
```

`manifest.json` records the capture method, SHA-256 hash, local path, media type, byte size, timestamp, and optional original filename, URL, or capture origin. Capture origin names the research or capture provider, how it was captured, and when. URL sources—including research captures—deduplicate by canonical URL. A successful new capture also appends a line to the topic’s dated update log.

Source files and `research.json` are included in workspace ZIP exports and remain ordinary readable files when the Dusori root sits inside an Obsidian vault. OCR for a scanned PDF, scheduled research, and unattended source acceptance remain [planned work](../roadmap/).

Applying a [curriculum import](../curricula/) also stores the official outline here before updating the topic roadmap, whether you pasted it or Dusori read it from an AWS exam guide PDF. Re-importing identical outline text reuses the existing source record.
