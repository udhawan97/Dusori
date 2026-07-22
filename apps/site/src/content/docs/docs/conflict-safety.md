---
title: Conflict safety
description: Why Dusori never silently replaces an externally edited Markdown file.
---

Dusori records the content hash and modification time it last observed for each user-owned Markdown file.

Before a write:

1. The current file is read again.
2. If its hash still matches, an explicitly accepted update can be written atomically.
3. If its hash changed, the external version stays in place.
4. Dusori writes `<name>.proposed-<timestamp>.md` beside it.
5. A dated entry links both versions from `Updates/YYYY/MM/YYYY-MM-DD.md`.

The application surfaces the current and proposed text as a diff. There is no last-write-wins path for user-owned Markdown.

The same protocol now protects in-app note editing. Dusori creates notes under `Notes/`, tracks them in `state.json`, and records accepted edits in the dated update log. If the note changed after the editor opened, **Save note** keeps that external content active and opens the proposal review instead.

Malformed machine JSON is renamed with an `.invalid-<timestamp>` suffix and surfaced instead of being silently rewritten.

Upgrading a URL source to its fetched full page text follows the same guard, but checks the content hash the app just read rather than one already on file: a URL source's recorded hash identifies its URL, not its saved content, so there is nothing else to compare against. An external edit made between that read and the confirmed replacement is still caught and refused.

ZIP replacement uses a different safety boundary because it replaces the whole browser workspace. Dusori validates the full archive before confirmation, snapshots the destination, and restores that snapshot if any replacement write fails. Preflight failures make no writes.
