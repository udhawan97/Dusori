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

Malformed machine JSON is renamed with an `.invalid-<timestamp>` suffix and surfaced instead of being silently rewritten.
