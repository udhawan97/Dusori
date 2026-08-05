---
title: Map and Outline
description: Explore a separated evidence atlas or linear outline derived from portable local files.
---

Choose **Map** in the primary navigation. The readable **Outline** opens first; the visual view is optional:

- **Outline** is a linear, keyboard- and screen-reader-friendly hierarchy with the same artifacts and actions.
- **Visual map** gives each topic a separate room, with named lanes for sources, notes, briefs and learning, and updates.

Neither view stores a graph database or invents progress. The research journey reports discovered, saved, read, and quoted counts from local files.

## What becomes a node

- The workspace and each topic are structural centers.
- Notes, dated updates, syntheses, and active source items are artifacts. Removed sources stay restorable but disappear from Map and its counts.
- `[[wikilinks]]` become edges when they resolve to one exact file.
- Backlinks are those resolved edges read in reverse.
- `tags:` frontmatter and inline `#tags` are derived on read and can filter the view.

View choice and Outline filters stay in app-local UI state, outside the portable workspace. The same files can be used in Obsidian without a Dusori plugin.

## Read the visual map

Each topic room begins with an evidence spine: discovered, saved, read, and quoted. Below it, every artifact has one readable home in Sources, Notes, Briefs & learning, or Updates. Cross-topic wikilinks appear as counted “Connects to” labels rather than lines crossing through other labels.

Nothing is positioned by physics and there is no zoom level to repair. Open any artifact directly from its lane.

## Use Outline for precision

Outline lists topics and their artifacts without requiring spatial navigation. Use it when you want a predictable reading order, a compact audit of the workspace, or search and kind/tag filters.

## Link health

The health ledger counts notes, sources, resolved wikilinks, and unresolved links. It also validates source manifests and the proposal ledger. Refreshing health is read-only.

Dusori can create the missing file named by one exact unresolved wikilink only after you choose that repair. It never rewrites an existing note to make a link work, and ambiguous links remain unresolved.
