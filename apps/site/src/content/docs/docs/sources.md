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

## Research missions

Every topic is a research mission, and its status is read from your files rather than stored. **Today** opens with one strip per unfinished topic: how many candidates have been discovered, how many sources are saved, how many have been read into quoted passages, when the topic was last refreshed, and which of five source lenses — documentation, academic, community, video, and general web — still have nothing saved. A provider that failed on the last scan is named there, so partial coverage is never shown as an empty field.

## Automatic research from a topic or an objective

Creating a topic opens the first-class **Research** workspace and prepares one automatic discovery run. Research begins as soon as at least one provider is allowed. Later runs use **Scan for strong sources**. Each provider is blocked on first use until you accept its host-specific disclosure; consent is stored on this device.

**What to ask** chooses the question the scan puts to providers. Five angles are derived from the topic itself — definition and scope, how it works, debates and criticism, practice and tools, and recent developments — and each sends the topic's own name plus that angle's words. Curriculum topics can instead pick **Your roadmap objective** and scan for the objective selected beside it.

Without the companion, Dusori can query seven keyless public providers: Microsoft Learn, English Wikipedia, Hacker News, GitHub, Stack Exchange, OpenAlex, and the npm registry. Allowed providers are searched together. A failed or slow provider is reported as skipped without discarding useful results from the others. Candidates are deterministically ranked from query relevance, provider-relative community signals, recency, and a small transparent host-reputation nudge. Dusori selects a diverse top-five shortlist and displays the reasons behind each result.

Results remain suggestions until you choose **Add to sources**. Microsoft Learn captures are labeled as catalog references, not page snapshots. Wikipedia extracts stay below the same 2 MiB source cap and end with `[truncated]` when the full extract would exceed it. Other browser providers preserve the public reference and provider metadata. An accepted source keeps the ranking reasons that surfaced it, along with the publisher, the author, and the publication date where the provider reports them. **Dismiss** records the result key locally so it stays out of later searches.

## The research trail

**Keep this topic fresh** gives Dusori standing permission to re-scan this topic when you open it and it has gone seven days without a scan, using only the providers you already allowed. It never runs on a first visit, never more than once per session, and never while Dusori is closed. The refresh says what it found, including when it found nothing new. The setting lives in `research.json` and travels with your workspace.

Every scan is written into the topic's `research.json` and shown under **Research trail**: when it ran, the exact text providers received, which angle asked, how many results were new, and one line per provider reporting `found` with a count, `nothing matched`, or `failed` with the failure's own message. The trail holds the fifty most recent runs and survives reload, so a provider outage still reads as an outage the next day. A scan in which every provider failed is recorded like any other — Dusori never presents a failure as an absence of material.

## Understand this topic

Three actions turn approved sources into something you can learn from. None of them contacts the network.

**Read saved sources** reads the text already on your device and stores up to twelve verbatim excerpts per source, each tagged with the heading it sat under. Excerpts are quotations, never paraphrase, and no model takes part. A source that holds only an unfetched reference is reported with the route to its text rather than skipped in silence.

**Build synthesis** writes `Synthesis.md` into the topic. It groups those quotations by subject, names which ideas more than one source supports, marks single-source ideas as thin evidence, builds a timeline once at least three sources carry dates, and lists the open questions the evidence raises. Every line is a quotation linking back to its source file. Rebuilding over a synthesis you have edited produces a proposal for review instead of overwriting your work.

With the companion running and an AI provider configured, the synthesis also gains two or three paragraphs of overview prose, written over those same quoted passages and labeled with the model that wrote it. Nothing else is sent. The quotations, their citations, the thin-evidence marking, the timeline, and the evidence table stay deterministic, and an unavailable model writes the document without commentary and says so.

**Create learning page** writes `Learning/learn.html`: concepts with their supporting quotations, an optional timeline, and reveal-style check-yourself prompts that keep no score and store nothing. The page inlines its own styles and script, makes no network request of any kind, works offline, opens without Dusori, and travels in your ZIP export. A page edited outside Dusori is kept and the rebuild is written beside it.

**Open learning page** reads it back inside Dusori. It runs in a sandbox that permits its own scripts but denies it the app's origin, so the page keeps its interactivity while being unable to reach your workspace, its storage, or its cookies. The stored file carries no theme of its own and follows your system preference when you open it directly; only the copy shown inside Dusori is matched to the app's current theme.

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

The companion is published as [`@udhawan97/dusori`](https://www.npmjs.com/package/@udhawan97/dusori) and released alongside the app at v0.11.0. With Node.js 24, run `npx @udhawan97/dusori@latest`; approve one existing folder with `npx @udhawan97/dusori@latest --root "/path/to/Dusori"`, or omit `--root` to keep folder access off. The [v0.11.0 source ZIP](https://github.com/udhawan97/Dusori/archive/refs/tags/v0.11.0.zip) and repository clone remain available through `npm start`. Follow [Getting started](../getting-started/) for the complete setup.

## Topic file contract

```text
Topics/<topic-slug>/
  Sources/
    manifest.json
    items/
      <sha-prefix>-<portable-title>.md|txt
  research.json     # run trail, seen results, and dismissals
  Synthesis.md      # generated, cited, regenerated through review
  Learning/
    learn.html      # generated, self-contained, opens without Dusori
  Updates/YYYY/MM/YYYY-MM-DD.md
```

`manifest.json` records the capture method, SHA-256 hash, local path, media type, byte size, timestamp, and optional original filename, URL, or capture origin. Capture origin names the research or capture provider, how it was captured, and when. A research capture also keeps the ranking reasons that selected it, the publisher, the author, the publication date, whether its text has been read, and its quoted passages. URL sources—including research captures—deduplicate by canonical URL. A successful new capture also appends a line to the topic’s dated update log.

Source files, `research.json`, `Synthesis.md`, and the learning page are all included in workspace ZIP exports and remain ordinary readable files when the Dusori root sits inside an Obsidian vault. OCR for a scanned PDF, and any research or source acceptance while Dusori is closed, remain [planned work](../roadmap/).

Applying a [curriculum import](../curricula/) also stores the official outline here before updating the topic roadmap, whether you pasted it or Dusori read it from an AWS exam guide PDF. Re-importing identical outline text reuses the existing source record.
