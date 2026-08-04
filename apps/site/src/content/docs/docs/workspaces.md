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

Firefox and Safari use the browser workspace plus ZIP import/export. The macOS and Windows desktop apps use the native Tauri storage adapter while preserving the same logical tree and guard rules.

Every topic keeps its own source files, manifest, research and review state, and proposal lifecycle, so moving a topic preserves the learning material and its provenance metadata. See [Sources](../sources/) for the capture limits and file contract.

Two of those files are generated rather than written by you. `Synthesis.md` is ordinary Markdown quoting your approved sources, and `Learning/learn.html` is a self-contained page that inlines its own styles and script and makes no network request — it opens in any browser without Dusori. Both travel in a ZIP export and both are protected if you edit them: a rebuilt synthesis becomes a proposal for review instead of overwriting your version, and an edited learning page is kept while the rebuild is written beside it. `research.json` holds the topic's research trail and its freshness setting.

The [portable knowledge graph](../knowledge-graph/) reads these same files and does not add a graph database or hidden sync layer.

## Import and replacement safety

Before replacing a workspace from ZIP, Dusori validates the archive before the first destination write: normalized paths, bounded compressed and expanded sizes, bounded file count and per-file size, the workspace schema, every topic schema, and each required topic/source file. The confirmation names the incoming workspace and reports topic and file counts.

An invalid archive does not touch the current workspace. For a valid replacement, Dusori writes complete staged and backup copies before removing any live file. If a storage write then fails, Dusori clears the partial import and restores the backup before reporting the failure. If persistent device failure prevents that restoration, the untouched copy remains under `.dusori-import-recovery/backup`; Dusori refuses another replacement until it is exported or recovered. Compatible unknown machine-file fields are preserved during supported edits. Keep an independent ZIP backup anyway: this recovery boundary does not protect against browser data clearing or device loss.
