---
title: Learning loop
description: Track roadmap progress and recent work without giving up portable files.
---

Dusori’s learning loop has two views backed by the files already inside each topic:

- **Roadmap** reads section headings and `- [ ]` / `- [x]` tasks from `roadmap.md`.
- **Today** opens with one research mission strip per unfinished topic — sources discovered, sources saved, passages read, when it was last refreshed, and which source lenses are still empty — then workspace-wide continuation and attention lanes, roadmap progress, topic status, review state, workspace health, and recent entries from `Updates/`. See [Sources](../sources/) for how a mission is researched.

There is no hosted task database. A schedule exists only where you created one with an explicit review action — Dusori never generates one on its own. The same progress remains readable in Obsidian or any Markdown editor.

## Complete an objective

Open **Roadmap** and check an objective. Dusori changes only that task marker, updates the tracked roadmap hash, and adds a dated entry to the topic’s update log. Reopening an objective follows the same path.

Imported curriculum section headings remain visible but are not counted as tasks. The percentage reflects only checkable Markdown objectives.

## Set topic status

Choose **Active**, **Paused**, or **Complete** from the roadmap header. Status is explicit and independent from checklist progress: completing every objective does not silently mark the topic complete.

## Continue learning

Today begins with **Continue learning**, a deterministic workspace-wide lane. It excludes complete topics, puts due spaced reviews first, then orders remaining active topics before paused topics by the oldest `state.json.updatedAt` value, using title and slug as stable tie-breakers.

The action comes only from explicit local evidence:

- A due review with at least one approved, locally readable source opens **Start review**.
- An unfinished objective without readable local source text opens **Research objective**.
- Another unfinished source-ready objective opens its roadmap and also offers **Start review** as an
  optional, non-scheduling action.
- A paused topic opens without silently resuming it.

A URL-only reference does not make an objective source-ready. Dusori claims only that text is available on this device; it does not judge source quality, completeness, or understanding. Opening a continuation item never changes progress.

## Needs attention

The adjacent **Needs attention** lane contains only conditions proven by current workspace evidence. Pending edit proposals and invalid or missing source records are integrity issues; unresolved wikilinks remain secondary hygiene and never displace learning. Related health issues are summarized and route to **Workspace health**, where the existing evidence and repairs remain authoritative.

Proposal state is portable and durable in `Topics/<slug>/proposals.json`. If Dusori protects an external edit, Today can recover that pending proposal after a reload and reopen the exact diff. Accepting it or keeping the current document resolves the ledger entry while preserving both Markdown versions. Older `.proposed-*` files created before the ledger remain readable history and are never guessed to be pending.

Marking a review with **Got it** or **Needs work** stores the topic's next due date in its `review.json`, using a fixed interval ladder (1, 3, 7, 14, 30, then 60 days). `Got it` advances one rung; `Needs work` resets to the first rung.

## Start a source-grounded review

**Start review** on a queue item opens a session built from the topic's current objective and its own approved sources. Dusori composes three to five active-recall prompts from transparent templates over the objective, the source headings, and short excerpts — no model is required.

Each prompt names the source it came from and keeps its excerpt hidden until you choose **Reveal the source**, which then shows the source title, its section, and its path inside your workspace. Only sources with readable text on this device are used: a URL kept as a reference is named and left alone, because Dusori never fetches a page on its own.

Every prompt has an answer box. What you type stays in the session until you choose **Save answers as a note**, which writes one ordinary Markdown note under `Topics/<slug>/Notes/`: your answers verbatim, each prompt quoted and labelled with its generator, and the source path behind it. Closing or rating with unsaved answers asks once instead of dropping them.

Nothing else in a session is stored. Opening it, moving between prompts, and revealing evidence write nothing; only the final **Got it** or **Needs work** changes the schedule. Nothing in a session is a score, a streak, or evidence that you understand the topic.

With the local companion running and an AI provider configured, **Allow sharper prompts** may reword the questions. It is a separate consent from AI ranking, because it sends the objective and up to four short excerpts of 320 characters each — your notes, roadmap, and review history are never sent. The model can only change wording: the prompt count, their order, the evidence, and the rating actions are fixed, generated prompts are labelled with the model that wrote them, and any failure falls back to the deterministic templates.

The **7-day recap** reads at most 12 recent entries from `Updates/YYYY/MM/YYYY-MM-DD.md`, newest date first, including review actions. It writes no summary file. Dusori never generates a calendar entry, notification, or closed-app work.

## External edits

If `roadmap.md` changed since Dusori last wrote it, a checkbox action cannot overwrite the file. Dusori writes a dated `.proposed-…md` sibling and shows the changed lines. Choose **Keep external roadmap** to reload it, or **Use this progress choice** after reviewing the proposal. When the proposal was made from the current external roadmap, its other edits remain in the accepted content.
