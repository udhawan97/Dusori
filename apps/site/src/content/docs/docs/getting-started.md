---
title: Getting started
description: Create a private Dusori workspace and its first topic.
sidebar:
  order: 2
---

## Browser workspace

1. Open the Dusori app.
2. Choose **Create workspace**.
3. Enter a topic name and choose **Create topic**.
4. Dusori creates `Home.md`, `dusori.json`, and the topic’s complete folder tree.
5. Choose **Export workspace** after meaningful work. The ZIP is your portable backup.

Browser workspaces use origin-private storage. They are not uploaded, but clearing site data can remove them. Export regularly.

## Use an Obsidian vault

1. Open or create your vault in Obsidian.
2. Create a folder named `Dusori` inside the vault.
3. In Chrome or Edge on desktop, choose **Use Dusori with Obsidian** and then select only that `Dusori` folder—not the whole vault.

No plugin is required. On browsers without folder access, keep the browser workspace and use ZIP export/import to move the same portable files. See [Workspaces and folders](../workspaces/) for the access boundary.

## Continue the learning loop

1. Open **Roadmap** and check an objective when it is genuinely complete.
2. Set the topic to **Active**, **Paused**, or **Complete**. This state is stored in the topic’s `state.json`.
3. Open **Today** to see the next unchecked objective, overall progress, and recent entries from `Updates/`.

The Today view is deterministic: **Review next** orders active topics before paused topics and then shows the least recently updated first. The seven-day recap reads dated update entries. Neither feature generates a deadline or schedule. If another editor changes `roadmap.md`, Dusori keeps that version active and asks you to review a separate progress proposal.

Open **Graph** to see the topic’s Markdown artifacts and wikilinks. The visual graph and its keyboard-accessible artifact index are both created locally from the workspace folder.

## Write and find notes

1. In the inspector, enter a title under **Create a study note**.
2. Write ordinary Markdown and choose **Save note**.
3. Use **Search workspace** to find words across local Markdown and text files.
4. Open **Workspace health** to refresh unresolved-link and source-manifest checks, or inspect backlinks for the current document.

Search is read-only and session-only. It creates no index and sends no query to the companion or another service. A note changed by another editor stays active; Dusori shows your draft as a proposal for explicit review.

## Import a curriculum

1. Create or open a topic, then open the workspace inspector.
2. Under **Curriculum**, choose **Import curriculum**.
3. Paste an English Microsoft Learn study guide or a structured Markdown syllabus. An official page URL is optional provenance; Dusori does not open it.
4. Choose **Preview roadmap** and review every extracted item.
5. Choose **Apply roadmap**. Dusori saves the original outline in `Sources/` and opens the interactive roadmap while preserving its section hierarchy.

If the roadmap changed outside Dusori, the external content remains active and the imported version becomes a proposal until you explicitly accept it. See [Curriculum import](../curricula/) for formats and limits.

## Local companion

The optional companion holds the loopback security boundary and adds the two things the browser cannot do on its own: fetching a page you explicitly confirm and turning it into readable text, and reaching Microsoft Learn's ranked search. Both appear only when the app is opened through the companion. See [Sources](../sources/) for the fetch flow. Ollama and model transformations are still not provided.

Run the published companion with Node.js 24. This downloads and starts the current release without a global install:

```sh
npx @udhawan97/dusori@latest
```

To approve one existing workspace folder for the session:

```sh
npx @udhawan97/dusori@latest --root "/path/to/Dusori"
```

Or clone the repository and use the same cross-platform local path on macOS, Windows, or Linux:

```sh
git clone https://github.com/udhawan97/Dusori.git
cd Dusori
npm start
```

The first source run downloads the repository-pinned pnpm version, installs dependencies, builds the app and companion, and then opens Dusori. The companion binds only to `127.0.0.1`, uses a new token for each run, removes that token and the companion origin from the browser address immediately after a valid connection, and stops when its terminal process exits. Omit `--root` to keep folder access off.

Do not reopen a workspace containing a companion-upgraded source with v0.2.0. That older build can rename `Sources/manifest.json` after seeing the new provenance value. Update to v0.3.0 or later first; source content remains untouched, and a renamed manifest can be restored by renaming the `.invalid-<timestamp>` file back after updating.
