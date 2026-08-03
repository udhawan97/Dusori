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
  Synthesis.md
  TUTOR.md
  state.json
  research.json
  review.json
  proposals.json
  Learning/learn.html
  Notes/
  Updates/YYYY/MM/YYYY-MM-DD.md
  Sources/
    manifest.json
    items/<hash>-<source-name>.md|txt
  Backups/
```

## Obsidian compatibility

On a supported Chromium desktop browser:

1. Open or create the vault in Obsidian.
2. Create `<Vault>/Dusori/`.
3. In Dusori, choose **Use Dusori with Obsidian**.
4. Select only `<Vault>/Dusori/`—never the whole vault.

Dusori writes only inside that approved root. The resulting Markdown and wikilinks work in Obsidian, but Obsidian is never required and no plugin is installed.

Firefox and Safari use the browser workspace plus ZIP import/export. The optional local companion is the later cross-browser path for direct folder access.

Every topic keeps its own source files, manifest, research and review state, and proposal lifecycle, so moving a topic preserves the learning material and its provenance metadata. See [Sources](../sources/) for the capture limits and file contract.

Two of those files are generated rather than written by you. `Synthesis.md` is ordinary Markdown quoting your approved sources, and `Learning/learn.html` is a self-contained page that inlines its own styles and script and makes no network request — it opens in any browser without Dusori. Both travel in a ZIP export and both are protected if you edit them: a rebuilt synthesis becomes a proposal for review instead of overwriting your version, and an edited learning page is kept while the rebuild is written beside it. `research.json` holds the topic's research trail and its freshness setting.

The [portable knowledge graph](../knowledge-graph/) reads these same files and does not add a graph database or hidden sync layer.

## Import and replacement safety

Before replacing a browser workspace from ZIP, Dusori validates the archive in memory: normalized paths, 64 MiB compressed and expanded limits, at most 5,000 files, the workspace schema, every topic schema, and each required topic/source file. The confirmation names the incoming workspace and reports topic and file counts.

An invalid archive does not touch the current workspace. If a storage write fails after replacement starts, Dusori clears the partial import and restores its previous snapshot before reporting the failure. Keep an independent ZIP backup anyway: rollback protects a failed Dusori write, not browser data clearing or device loss.
