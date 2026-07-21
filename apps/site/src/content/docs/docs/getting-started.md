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

The Today view is deterministic: it reads your local files and does not generate a schedule. If another editor changes `roadmap.md`, Dusori keeps that version active and asks you to review a separate progress proposal.

Open **Graph** to see the topic’s Markdown artifacts and wikilinks. The visual graph and its keyboard-accessible artifact index are both created locally from the workspace folder.

## Import a curriculum

1. Create or open a topic, then open the workspace inspector.
2. Under **Curriculum**, choose **Import curriculum**.
3. Paste an English Microsoft Learn study guide or a structured Markdown syllabus. An official page URL is optional provenance; Dusori does not open it.
4. Choose **Preview roadmap** and review every extracted item.
5. Choose **Apply roadmap**. Dusori saves the original outline in `Sources/` and opens the interactive roadmap while preserving its section hierarchy.

If the roadmap changed outside Dusori, the external content remains active and the imported version becomes a proposal until you explicitly accept it. See [Curriculum import](../curricula/) for formats and limits.

## Local companion

The optional companion currently proves the loopback security boundary. It does not yet provide Ollama or source fetching.

The v0.2.0 GitHub release does not publish the companion to npm. Build and run it from a clone:

```sh
corepack enable
pnpm install
pnpm build
pnpm --filter dusori dev -- --root /path/to/Dusori
```

After a separate npm release, the equivalent public command will be `npx dusori --root /path/to/Dusori`. The companion binds only to `127.0.0.1`, uses a new token for each run, and stops when its terminal process exits.
