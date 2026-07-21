---
title: Sources
description: Add local material or accept disclosed research without uploading your workspace.
---

Each topic has a local source library. Open the workspace inspector, choose **Source type**, give the item a title, and select **Add source**.

## Supported source types

- **Pasted text:** stored as a readable `.txt` file.
- **Local text file:** `.md`, `.markdown`, and `.txt` files up to 2 MiB. Markdown stays Markdown; line endings are normalized for portability.
- **URL reference:** stores the complete `http://` or `https://` address in a small Markdown reference file. Dusori does not fetch or copy the page.
- **Accepted research:** stores a Microsoft Learn catalog reference or an English Wikipedia plain-text extract only after preview and explicit acceptance.

URLs containing embedded usernames or passwords are rejected. Opening a saved URL is an explicit browser action and can contact that website.

## Research from a roadmap objective

The **Research** section defaults to the next unchecked objective. **Search Microsoft Learn** ranks the public module catalog locally. **Search Wikipedia** uses the English search API; previewing a result retrieves that selected page's plain-text extract. Each provider is blocked on first use until you accept its host-specific disclosure. Nothing else from the workspace is sent.

Results remain suggestions until you choose **Add to sources**. Microsoft Learn captures are labeled as catalog references, not page snapshots. Wikipedia extracts stay below the same 2 MiB source cap and end with `[truncated]` when the full extract would exceed it. **Dismiss** records the result key locally so it stays out of later searches.

## Topic file contract

```text
Topics/<topic-slug>/
  Sources/
    manifest.json
    items/
      <sha-prefix>-<portable-title>.md|txt
  research.json  # created after the first dismissal
  Updates/YYYY/MM/YYYY-MM-DD.md
```

`manifest.json` records the capture method, SHA-256 hash, local path, media type, byte size, timestamp, and optional original filename, URL, or research origin. Research origin names `mslearn` or `wikipedia`, the capture method, and the capture time. URL sources—including research captures—deduplicate by canonical URL. A successful new capture also appends a line to the topic’s dated update log.

Source files and `research.json` are included in workspace ZIP exports and remain ordinary readable files when the Dusori root sits inside an Obsidian vault. Arbitrary web-page fetching, PDF extraction, key-based search, and AI transformation remain [planned work](../roadmap/).

Applying a [curriculum import](../curricula/) also stores the pasted official outline here before updating the topic roadmap. Re-importing identical outline text reuses the existing source record.
