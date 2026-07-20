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

## Local companion

The optional companion currently proves the loopback security boundary. It does not yet provide Ollama or source fetching.

The npm package is not published in this workspace-foundation milestone. Build and run it from a clone:

```sh
corepack enable
pnpm install
pnpm build
pnpm --filter dusori dev -- --root /path/to/Dusori
```

After the first npm release, the equivalent public command will be `npx dusori --root /path/to/Dusori`. The companion binds only to `127.0.0.1`, uses a new token for each run, and stops when its terminal process exits.
