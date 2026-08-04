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
| macOS Apple silicon | Your Mac has an M-series processor                              | [Download Apple silicon `.dmg`](https://github.com/udhawan97/Dusori/releases/download/v0.12.2/Dusori_0.12.2_aarch64-aarch64-apple-darwin.dmg)   |
| Windows x64         | You use 64-bit Windows                                          | [Download Windows x64 `.exe`](https://github.com/udhawan97/Dusori/releases/download/v0.12.2/Dusori_0.12.2_x64-setup-x86_64-pc-windows-msvc.exe) |
| Node companion      | You want browser UI plus local capture and configured providers | `npx @udhawan97/dusori@latest`                                                                                                                  |

The v0.12.2 macOS and Windows installers are not Apple-notarized or Microsoft code-signed. The operating system may warn on first launch. Download only from the Dusori GitHub release and compare it with `SHA256SUMS.txt`. In-app update artifacts use a separate cryptographic updater signature.

If you installed a v0.12.0 or v0.12.1 desktop build, install v0.12.2 manually once. Both affected versions open to a launch-time 404, so Settings is inaccessible. The Intel v0.12.0 Mac build also cannot safely select the Apple silicon updater feed. Replacing the application does not remove the separately stored workspace; normal in-app updates resume from v0.12.2 onward.

## Create the first topic

1. Choose **Create workspace**.
2. Enter a certification such as `Azure AI-102` or a general subject such as `AI fundamentals`.
3. Choose **Create topic**. The new topic opens in **Learn**.
4. Choose **Find sources** when the next step needs evidence.
5. Turn on one provider after reading its disclosure. No request is sent before consent.
6. Choose **Preview** on a candidate. The Sources count must not change.
7. Choose **Save source** to add it to the shelf, or **Save & read** to add it and open the Reading room.

The primary navigation always means the same thing:

- **Learn** gives you the next action and the topic’s learning tools.
- **Sources** is the saved evidence shelf.
- **Map** shows the galaxy and accessible Outline.
- **Settings** holds storage, privacy, export/import, companion status, and updates.

## Continue the topic

Learn orders due reviews first, then unfinished active topics, then paused topics. The route depends on current files: it may open a due review, a ready source, the next roadmap objective, or Find sources. Routing changes nothing by itself.

Use **Learning path** to inspect the roadmap. An objective becomes complete only when you explicitly mark that checkbox; reopening it follows the same guarded write path. Topic-level **Active**, **Paused**, and **Complete** are separate from objective progress.

Use **Learning evidence** to inspect file-derived activity, progress, source provenance, links, and review pressure. These are signals, not a score or mastery claim.

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

- A failed provider is named in the Research trail. Retry it or allow another provider.
- A scanned PDF with no text layer is reported; Dusori includes no OCR.
- A saved URL reference remains a reference until you explicitly fetch it through the companion or replace it with pasted/local text.
- If an external editor changes tracked Markdown, Dusori preserves it and writes a proposal for review.
- If an update fails, keep using the installed version and follow [Updates and recovery](../updates/).
- If browser data may be at risk, export the workspace before troubleshooting.
