---
title: Learning loop
description: Track roadmap progress and recent work without giving up portable files.
---

Dusori’s learning loop has two views backed by the files already inside each topic:

- **Roadmap** reads section headings and `- [ ]` / `- [x]` tasks from `roadmap.md`.
- **Today** combines roadmap progress, the topic status in `state.json`, and recent entries from `Updates/`.

There is no hosted task database and no generated schedule. The same progress remains readable in Obsidian or any Markdown editor.

## Complete an objective

Open **Roadmap** and check an objective. Dusori changes only that task marker, updates the tracked roadmap hash, and adds a dated entry to the topic’s update log. Reopening an objective follows the same path.

Imported curriculum section headings remain visible but are not counted as tasks. The percentage reflects only checkable Markdown objectives.

## Set topic status

Choose **Active**, **Paused**, or **Complete** from the roadmap header. Status is explicit and independent from checklist progress: completing every objective does not silently mark the topic complete.

## Review Today

Today shows every topic’s status, completed-task count, next unchecked objective, and three most recent local update entries. It is a current-file summary rather than a planner. Optional generated scheduling and recap suggestions remain planned work.

## External edits

If `roadmap.md` changed since Dusori last wrote it, a checkbox action cannot overwrite the file. Dusori writes a dated `.proposed-…md` sibling and shows the changed lines. Choose **Keep external roadmap** to reload it, or **Use this progress choice** after reviewing the proposal. When the proposal was made from the current external roadmap, its other edits remain in the accepted content.
