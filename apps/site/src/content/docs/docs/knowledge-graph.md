---
title: Portable knowledge graph
description: How Dusori maps local Markdown and Obsidian wikilinks without a graph database.
---

Dusori’s graph is a view of the workspace, not a second storage system. **No graph database** is created, no server receives the graph, and no proprietary file is required to reconstruct it.

## What becomes a node

- `Home.md` is the workspace center.
- Each topic’s `Overview.md` is a topic center.
- Roadmaps, learning preferences, notes, dated updates, and readable source files are artifacts around that topic.

The graph uses normalized relative file paths as stable node IDs. Labels come from Markdown frontmatter, then the first heading, then the filename.

## What becomes an edge

- Topic containment connects an overview to the files carried by that topic.
- Obsidian-style `[[wikilinks]]` connect the source file to the resolved target.
- Links that cannot be resolved stay visible as an unresolved-link count; Dusori does not invent a destination.

## Open a document

Choose **Graph** in the workspace rail. The constellation is paired with an accessible artifact index. Select an artifact there to open the original Markdown or text file in Dusori.

The constellation scales with workspace size and orders topics by their wikilink affinity. The layout remains deterministic and browser-local and writes no coordinates into your workspace, so opening the same folder in Obsidian remains clean.

## Portability and privacy

Exporting or connecting the workspace already carries everything needed to rebuild the graph. The graph works offline after the app is loaded and does not require an account, plugin, telemetry endpoint, or AI model.
