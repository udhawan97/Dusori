---
title: Sources
description: Add learning material without uploading it or silently fetching the web.
---

Each topic has a local source library. Open the workspace inspector, choose **Source type**, give the item a title, and select **Add source**.

## Supported source types

- **Pasted text:** stored as a readable `.txt` file.
- **Local text file:** `.md`, `.markdown`, and `.txt` files up to 2 MiB. Markdown stays Markdown; line endings are normalized for portability.
- **URL reference:** stores the complete `http://` or `https://` address in a small Markdown reference file. Dusori does not fetch or copy the page.

URLs containing embedded usernames or passwords are rejected. Opening a saved URL is an explicit browser action and can contact that website.

## Topic file contract

```text
Topics/<topic-slug>/
  Sources/
    manifest.json
    items/
      <sha-prefix>-<portable-title>.md|txt
  Updates/YYYY/MM/YYYY-MM-DD.md
```

`manifest.json` records the capture method, SHA-256 hash, local path, media type, byte size, timestamp, and optional original filename or URL. Identical content added through the same method is de-duplicated. A successful new capture also appends a line to the topic’s dated update log.

Source files are included in workspace ZIP exports and remain ordinary readable files when the Dusori root sits inside an Obsidian vault. Web-page fetching, PDF extraction, search, and AI transformation remain [planned work](../roadmap/).
