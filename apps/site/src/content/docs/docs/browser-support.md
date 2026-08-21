---
title: Browser and desktop support
description: Supported storage, offline, companion, desktop, and installer behavior.
---

## Runtime matrix

| Capability                | Chromium desktop | Firefox / Safari               | Mobile browser     | macOS desktop        | Windows x64 desktop  |
| ------------------------- | ---------------- | ------------------------------ | ------------------ | -------------------- | -------------------- |
| Private local workspace   | Yes              | Yes                            | Yes¹               | Yes                  | Yes                  |
| ZIP import/export         | Yes              | Yes                            | Yes                | Yes                  | Yes                  |
| Direct folder connection  | Yes              | Use ZIP                        | Best effort²       | Native app workspace | Native app workspace |
| Hosted PWA/offline shell  | Yes              | Browser-dependent¹             | Browser-dependent¹ | Not applicable       | Not applicable       |
| Loopback companion        | Yes              | Yes where localhost is allowed | No supported path  | Bundled sidecar      | Bundled sidecar      |
| Signed in-app update feed | No; refresh site | No; refresh site               | No; refresh site   | Yes                  | Yes                  |

¹ Dusori prefers OPFS when the browser can open it and falls back to a device-local IndexedDB
workspace when it cannot. The selected backend is recorded and reopened consistently; Dusori will
not silently substitute an empty backend when recorded storage is unavailable. Browser storage
retention and PWA support still vary, so export backups.

² Mobile folder writes are not a reliable atomic-storage contract; ZIP remains the portable path.

The app needs JavaScript, IndexedDB, Web Crypto, and service workers for the hosted offline shell. Direct folder access uses the File System Access API and is intentionally limited to browsers that implement the required semantics.

## Desktop targets

v0.13.0 produces separate artifacts for:

- macOS 12 or newer on Apple silicon (`aarch64`);
- 64-bit Windows (`x86_64`, current-user NSIS installer).

The installers are not Apple-notarized or Microsoft code-signed, so the operating system may show a first-launch warning. Release assets include `SHA256SUMS.txt`. Automatic-update artifacts are separately signed with the Dusori updater key and are rejected when the signature does not match.

## Network capabilities

All builds can use eleven consent-gated browser providers: Microsoft Learn, Wikipedia, Hacker News, GitHub, Stack Overflow, Europe PMC, OpenAlex, Library of Congress, Crossref, Open Library, and npm. Routing happens locally before consent, so a biomedical or cultural-heritage specialist receives a query only when its narrow topic rules match and the learner has allowed it. The provider catalog declares browser origins, and tests require both hosted and desktop content-security policies to permit every declared origin.

The companion or desktop sidecar can add arXiv, configured Reddit, YouTube metadata search through a user-supplied `YOUTUBE_API_KEY` with an optional self-hosted `INVIDIOUS_URL` fallback, configured Brave/Tavily/SearXNG web search, and optional Ollama/Anthropic/OpenAI assistance. Provider setup and legal boundaries are in the [provider matrix](../research-providers/).

There is no closed-app research, review scheduler, notification service, or unattended installer.

The **System** appearance follows operating-system light/dark changes while Dusori is open. Explicit Paper, Ink, and Night choices remain fixed until changed.
