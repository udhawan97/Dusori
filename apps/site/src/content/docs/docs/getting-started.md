---
title: Getting started
description: Open Dusori, create a topic, save the first source, and understand the desktop choices.
sidebar:
  order: 2
---

## Choose a build

| Build               | Use it when                                                     | Start                                                                                                                                           |
| ------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser             | You want the fastest, accountless start                         | [Open Dusori](https://udhawan97.github.io/Dusori/app/)                                                                                          |
| macOS Apple silicon | Your Mac has an M-series processor                              | [Download Apple silicon `.dmg`](https://github.com/udhawan97/Dusori/releases/download/v0.12.4/Dusori_0.12.4_aarch64-aarch64-apple-darwin.dmg)   |
| Windows x64         | You use 64-bit Windows                                          | [Download Windows x64 `.exe`](https://github.com/udhawan97/Dusori/releases/download/v0.12.4/Dusori_0.12.4_x64-setup-x86_64-pc-windows-msvc.exe) |
| Node companion      | You want browser UI plus local capture and configured providers | `npx @udhawan97/dusori@latest`                                                                                                                  |

The v0.12.4 macOS and Windows installers are not Apple-notarized or Microsoft code-signed. The operating system may warn on first launch. Download only from the Dusori GitHub release and compare it with `SHA256SUMS.txt`. In-app update artifacts use a separate cryptographic updater signature.

If you installed a v0.12.0 or v0.12.1 desktop build, install v0.12.4 manually once. Both affected versions open to a launch-time 404, so Settings is inaccessible. The Intel v0.12.0 Mac build also cannot safely select the Apple silicon updater feed. Replacing the application does not remove the separately stored workspace; normal in-app updates work from v0.12.2 onward.

## Create the first topic

1. Choose **Create workspace**.
2. Enter a certification such as `Azure AI-102` or a general subject such as `AI fundamentals`.
3. Choose **Create topic**. The new topic opens at the **Research Desk**.
4. Enter the question you want answered.
5. Select one or more providers after reading their disclosures. No request is sent before consent.
6. Choose **Research topic**. Dusori searches, deduplicates, ranks, saves up to eight varied sources, reads available text, and builds a quoted brief automatically.
7. Open **Sources** to read a local copy, retry a blocked page, open the original in your browser, remove a source, or restore one later.

The primary navigation always means the same thing:

- **Research** turns a plain-language question into a durable source trail and brief.
- **Sources** is the saved evidence shelf, including readable and browser-only references.
- **Map** opens as a readable research Outline; the separated visual evidence atlas is optional.
- **Settings** holds appearance, storage, privacy, export/import, companion status, updates, and optional learning tools.

## Follow the research

Every run keeps the exact query and one outcome per provider: `found`, `empty`, or `failed`. Those outcomes survive reload. A failed provider is not shown as an empty result, and a zero-result query does not reuse an older brief as its answer.

Readable captures contribute quoted passages to `Synthesis.md`. A URL-only reference remains useful as an **Open original** browser link but cannot support a claim until the companion reads it or you add permitted text. HTTP 401, 403, and 429 failures remain visible after reload.

Roadmaps, objectives, review prompts, and learning pages remain optional under **Settings → Optional learning tools**. A certification topic preserves that intent across relaunches and offers the exact official-outline importer until an outline is applied.

## Make a portable backup

Open **Settings → Storage** and choose **Export workspace**. Browser workspaces live in origin-private site storage: they are local, but clearing site data can remove them. Export after meaningful work.

Supported Chromium browsers can connect a folder you choose, including a `Dusori` subfolder inside an Obsidian vault. Other browsers use private storage plus ZIP import/export. See [Workspaces and folders](../workspaces/).

## Run the companion

Install [Node.js 24 LTS](https://nodejs.org/en/download), then run:

```sh
npx @udhawan97/dusori@latest
```

To approve one existing workspace folder for this process:

```sh
npx @udhawan97/dusori@latest --root "/path/to/Dusori"
```

The companion binds to a random `127.0.0.1` port and opens the bundled app. A same-origin, HttpOnly, SameSite session cookie connects that bundled page; the credential is not printed or placed in the URL. API-only desktop sessions receive their credential through the process environment and accept only the exact desktop origin. Closing the terminal stops the ordinary `npx` companion.

From source:

```sh
git clone https://github.com/udhawan97/Dusori.git
cd Dusori
npm run setup
npm start
```

## Update the desktop app

Open **Settings → App updates**. **Check now** queries the signed GitHub release feed. If a release is available, choose **Download update**; after signature verification, choose **Install and restart**. Installation is blocked while work is unsaved.

You may opt in to automatic checks and downloads. That option never authorizes installation or restart. See [Updates and recovery](../updates/) for failure recovery.

## If something goes wrong

- A failed provider is named in the latest Research lookup. Retry it, allow another provider, or use the browser-search fallback.
- A scanned PDF with no text layer is reported; Dusori includes no OCR.
- A manual URL reference remains a reference until you choose **Read from _host_** through the companion or add pasted/local text.
- If an external editor changes tracked Markdown, Dusori preserves it and writes a proposal for review.
- If an update fails, keep using the installed version and follow [Updates and recovery](../updates/).
- If browser data may be at risk, export the workspace before troubleshooting.
