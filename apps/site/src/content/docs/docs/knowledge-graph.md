---
title: Map and Outline
description: Explore a galaxy or linear outline derived from portable local files.
---

Choose **Map** in the primary navigation. The readable **Outline** opens first; the visual view is optional:

- **Outline** is a linear, keyboard- and screen-reader-friendly hierarchy with the same artifacts and actions.
- **Visual map** is an explorable constellation of topics, notes, sources, and resolved wikilinks.

Neither view stores a graph database or invents progress. The research journey reports discovered, saved, read, and quoted counts from local files.

## What becomes a node

- The workspace and each topic are structural centers.
- Notes, dated updates, syntheses, and active source items are artifacts. Removed sources stay restorable but disappear from Map and its counts.
- `[[wikilinks]]` become edges when they resolve to one exact file.
- Backlinks are those resolved edges read in reverse.
- `tags:` frontmatter and inline `#tags` are derived on read and can filter the view.

Graph coordinates, zoom, filters, and display preferences stay in app-local UI state, outside the portable workspace. The same files can be used in Obsidian without a Dusori plugin.

## Explore the visual map

Use pointer, wheel, touch, or the keyboard-operable controls to pan and zoom. Link length and spacing change the view only. Search the artifact finder, filter by kind or tag, and open the original file from a result.

The deterministic initial layout means the same file relationships begin from the same geometry. A local force pass makes dense areas readable; it does not write positions to disk.

## Use Outline for precision

Outline lists topics and their artifacts without requiring spatial navigation. Use it when you want a predictable reading order, a compact audit of the workspace, or an accessible alternative to the galaxy.

## Link health

The health ledger counts notes, sources, resolved wikilinks, and unresolved links. It also validates source manifests and the proposal ledger. Refreshing health is read-only.

Dusori can create the missing file named by one exact unresolved wikilink only after you choose that repair. It never rewrites an existing note to make a link work, and ambiguous links remain unresolved.
