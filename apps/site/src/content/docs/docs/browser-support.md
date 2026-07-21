---
title: Browser support
description: The capability matrix for browser workspaces, real folders, offline use, and the companion.
---

| Capability                    | Chrome/Edge desktop                 | Chrome Android | Firefox desktop           | Safari macOS                    | Safari iOS         |
| ----------------------------- | ----------------------------------- | -------------- | ------------------------- | ------------------------------- | ------------------ |
| Browser workspace (OPFS)      | Yes                                 | Yes            | Yes                       | Yes¹                            | Yes¹               |
| ZIP import/export             | Yes                                 | Yes            | Yes                       | Yes                             | Yes                |
| Connect a real folder         | Yes                                 | Yes²           | No → import/export        | No → import/export              | No                 |
| Companion from hosted origin  | Local-network permission may appear | Not supported  | Supported                 | Blocked by mixed-content policy | Not supported      |
| Companion from localhost      | Yes                                 | Not supported  | Yes                       | Yes                             | Not supported      |
| Confirmed page extraction     | Via companion                       | Not supported  | Via companion             | Via companion localhost         | Not supported      |
| Ranked Microsoft Learn search | Via companion                       | Not supported  | Via companion             | Via companion localhost         | Not supported      |
| Ollama                        | Future via companion                | Not supported  | Future via companion      | Future via companion localhost  | Not supported      |
| Install                       | PWA                                 | PWA            | Tab + service worker only | Add to Dock                     | Add to Home Screen |
| Offline after first load      | Yes                                 | Yes            | Yes                       | Yes¹                            | Yes¹               |
| Closed-app scheduling         | No                                  | No             | No                        | No                              | No                 |

¹ Safari storage retention can be less predictable for sites used only in a browser tab. Add the app to the Dock or Home Screen where supported, and keep exported backups.

² Chrome Android 132+ exposes folder access, but its writes are not atomic. Dusori treats it as best-effort and keeps import/export as the portability baseline.

Ollama, AI behavior, and closed-app scheduling are not implemented in this milestone. An always-running daemon is not part of the product.
