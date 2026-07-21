---
title: Workspaces and folders
description: How Dusori stores portable files and works alongside Obsidian.
---

Every Dusori workspace is a folder-shaped collection of Markdown and JSON. Markdown is user-owned. JSON is machine-owned, schema-versioned, and validated before use.

```text
Home.md
dusori.json
Topics/<topic-slug>/
  Overview.md
  roadmap.md
  TUTOR.md
  state.json
  Notes/
  Updates/YYYY/MM/YYYY-MM-DD.md
  Sources/
    manifest.json
    items/<hash>-<source-name>.md|txt
  Backups/
```

## Obsidian compatibility

On a supported Chromium desktop browser, choose or create `<Vault>/Dusori/` as the connected root. Dusori writes only inside that root. The resulting Markdown and wikilinks work in Obsidian, but Obsidian is never required and no plugin is installed.

Firefox and Safari use the browser workspace plus ZIP import/export. The optional local companion is the later cross-browser path for direct folder access.

Every topic keeps its own source files and manifest, so moving a topic preserves the learning material and its provenance metadata. See [Sources](../sources/) for the capture limits and file contract.
