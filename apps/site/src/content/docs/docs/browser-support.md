---
title: Browser support
description: The capability matrix for browser workspaces, real folders, offline use, and the companion.
---

| Capability                    | Chrome/Edge desktop                 | Chrome Android | Firefox desktop           | Safari macOS                    | Safari iOS         |
| ----------------------------- | ----------------------------------- | -------------- | ------------------------- | ------------------------------- | ------------------ |
| Browser workspace (OPFS)      | Yes                                 | Yes            | Yes                       | Yes¹                            | Yes¹               |
| Local search/backlinks/health | Yes                                 | Yes            | Yes                       | Yes                             | Yes                |
| ZIP import/export             | Yes                                 | Yes            | Yes                       | Yes                             | Yes                |
| Connect a real folder         | Yes                                 | Yes²           | No → import/export        | No → import/export              | No                 |
| Companion from hosted origin  | Local-network permission may appear | Not supported  | Supported                 | Blocked by mixed-content policy | Not supported      |
| Companion from localhost      | Yes                                 | Not supported  | Yes                       | Yes                             | Not supported      |
| Confirmed page extraction     | Via companion                       | Not supported  | Via companion             | Via companion localhost         | Not supported      |
| Ranked Microsoft Learn search | Via companion                       | Not supported  | Via companion             | Via companion localhost         | Not supported      |
| arXiv/configured web search   | Via companion                       | Not supported  | Via companion             | Via companion localhost         | Not supported      |
| Optional AI assistance        | Via companion                       | Not supported  | Via companion             | Via companion localhost         | Not supported      |
| Install                       | PWA                                 | PWA            | Tab + service worker only | Add to Dock                     | Add to Home Screen |
| Offline after first load      | Yes                                 | Yes            | Yes                       | Yes¹                            | Yes¹               |
| Closed-app scheduling         | No                                  | No             | No                        | No                              | No                 |

¹ Safari storage retention can be less predictable for sites used only in a browser tab. Add the app to the Dock or Home Screen where supported, and keep exported backups.

² Chrome Android 132+ exposes folder access, but its writes are not atomic. Dusori treats it as best-effort and keeps import/export as the portability baseline.

All modern-browser columns can use the five keyless, consent-gated browser research providers. The companion can add arXiv, configured Brave/Tavily/SearXNG search, and optional Ollama/Anthropic/OpenAI assistance where its localhost connection is supported. Closed-app scheduling and an always-running daemon are not part of the product.
