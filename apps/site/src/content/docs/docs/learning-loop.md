---
title: Learning loop
description: How Continue, reading, roadmap progress, review, and evidence-backed attention work.
---

Dusori’s loop is `Continue → Read → Annotate → explicitly Mark learned or review → Map/Outline`.

## Continue

**Learn** opens with a deterministic next step. It excludes completed topics, puts due reviews first, then active topics before paused topics, with stable file-derived ordering.

The action depends on current evidence:

- a due, source-ready topic starts review;
- an objective without readable saved evidence opens **Find sources**;
- a source-ready unfinished objective opens its learning path;
- a paused topic opens without silently resuming it.

The recommendation changes no progress. **Needs attention** names only proven file conditions such as a pending proposal, invalid source record, or unresolved link. It is not a generic notification feed.

## Read and annotate

The **Sources** shelf lists only deliberately saved material. Opening a saved item enters the Reading room. Notes are ordinary Markdown and can point to other notes or sources with `[[wikilinks]]`.

If another editor changes a tracked Markdown file before Dusori saves, that content remains active. Dusori writes the attempted version beside it and records a durable proposal that can be accepted or kept later.

## Mark an objective learned

The learning path reads headings and `- [ ]` / `- [x]` tasks from `roadmap.md`. Marking an objective complete changes only that task marker, updates the tracked hash, and appends a dated update entry. Reopening it uses the same guarded write.

Objective progress is separate from topic state. **Active**, **Paused**, and **Complete** live in `state.json`; changing one never checks roadmap tasks.

Dusori calls this an explicit learning record, not proof of mastery.

## Review

A review session builds three to five deterministic prompts from the current objective and readable saved sources. Every prompt names its local source path and hides a bounded excerpt until requested.

- Starting, navigating, revealing, or abandoning a session writes nothing.
- Answers stay in memory unless you explicitly save them as a Markdown note.
- **Got it** and **Needs work** are the only actions that update `review.json`.
- The fixed interval ladder is 1, 3, 7, 14, 30, then 60 days.
- There is no score, streak, calendar event, notification, or closed-app scheduler.

Optional AI may reword prompts under separate consent covering the exact objective and excerpts. It cannot change count, order, evidence, or the review actions, and any failure keeps deterministic wording.

## See what changed

The seven-day recap reads dated update files. **Learning evidence** derives activity, objective progress, source provenance, link health, graph hubs, and review pressure from current workspace files. It does not infer study time or mastery.

**Map** shows the same notes and sources as a galaxy or accessible Outline. Opening either is read-only.
