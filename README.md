<p align="center">
  <img src="docs/assets/dusori-readme-logo-inverted.svg" width="720" alt="Dusori — animated inverted ensō, rangoli, and katana mark" />
</p>

<p align="center">
  <em>“A second brain should remember who owns the first.”</em>
</p>

<p align="center">
  Free, local-first learning from Markdown and JSON.<br />
  No account · no telemetry · no hosted database · useful without AI
</p>

<p align="center">
  <a href="https://github.com/udhawan97/Dusori/actions/workflows/ci.yml"><img alt="Verify and deploy" src="https://github.com/udhawan97/Dusori/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://github.com/udhawan97/Dusori/releases/tag/v0.3.0"><img alt="Release v0.3.0" src="https://img.shields.io/badge/release-v0.3.0-cb4832" /></a>
  <a href="LICENSE"><img alt="Apache License 2.0" src="https://img.shields.io/badge/license-Apache--2.0-cb4832" /></a>
  <img alt="Local first" src="https://img.shields.io/badge/data-local--first-c9862e" />
  <img alt="Progressive Web App" src="https://img.shields.io/badge/app-PWA-1a1511" />
</p>

<p align="center">
  <a href="https://udhawan97.github.io/Dusori/app/"><strong>Open the app</strong></a>
  ·
  <a href="https://udhawan97.github.io/Dusori/docs/">Documentation</a>
  ·
  <a href="https://udhawan97.github.io/Dusori/">Product page</a>
  ·
  <a href="https://github.com/udhawan97/Dusori/releases/tag/v0.3.0">v0.3.0 release</a>
</p>

---

Dusori turns plain Markdown and JSON into a private learning workbench: notes, a checkable roadmap, local sources, dated updates, and a knowledge graph that understands Obsidian-style `[[wikilinks]]`. Start in browser storage or connect one folder. Export a ZIP at any time. The app works offline after its first load and does not need an account, plugin, remote backend, or AI model.

The identity combines Japanese restraint—an open ensō and blade—with rangoli-like Indian geometry at the center. Vermilion marks action; marigold marks connected knowledge. The app starts in black mode and keeps an explicit light/dark choice locally.

## v0.3.0 — the bounded companion

Dusori v0.3.0 adds an optional, session-scoped local companion for capabilities a static browser app cannot safely provide alone. It can proxy Microsoft Learn's ranked search and turn a URL source into readable text only after an exact-host confirmation and preview. Every redirect is checked against non-public address ranges, content stays capped, writes remain conflict-safe, and the launch token is consumed from the address as soon as the companion connects.

[Read the release notes](https://github.com/udhawan97/Dusori/releases/tag/v0.3.0) · [Review the changelog](CHANGELOG.md)

## The product today

![Dusori workspace showing the local learning loop](apps/site/public/app-workspace.png)

| Surface            | What ships                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| **Today**          | Next unchecked objective, progress, topic state, and recent local updates                                                |
| **Roadmap**        | Ordinary Markdown checkboxes with active, paused, and complete topic states                                              |
| **Graph**          | Deterministic constellation of portable artifacts, topic containment, and wikilinks                                      |
| **Notes**          | Sanitized Markdown, Mermaid diagrams, and explicit conflict proposals                                                    |
| **Sources**        | Paste, local file, URL reference, accepted research capture with provenance, and companion-powered full-content upgrades |
| **Research**       | Consent-gated Microsoft Learn and Wikipedia suggestions from a roadmap objective                                         |
| **Curricula**      | Preview-first import for structured Markdown and English Microsoft Learn study guides                                    |
| **Portability**    | Browser storage, direct folder access where supported, and ZIP import/export                                             |
| **Installability** | PWA manifest, service worker, offline reload, and supplied Dusori app icons                                              |

Key-based search, Ollama transforms, generated schedules, and unattended work remain roadmap items. With the optional local companion running, Dusori also fetches the readable text of a URL source you explicitly confirm and proxies Microsoft Learn's ranked search; the hosted app alone stays keyless and limited to the Microsoft Learn catalog and English Wikipedia APIs.

## Obsidian, without surrendering the vault

Dusori uses Obsidian’s most durable interface: folders, Markdown, frontmatter, and wikilinks. No plugin is required.

1. Open or create an Obsidian vault.
2. Create `<Vault>/Dusori/`.
3. In Chrome or Edge on desktop, choose **Use Dusori with Obsidian**.
4. Select only the `Dusori` subfolder—never the whole vault.

Firefox and Safari use the private browser workspace plus ZIP import/export. Folder access is an enhancement, not a portability requirement.

## A graph that remains files

The graph does not introduce a graph database. `@dusori/core` scans readable workspace files, gives every node its normalized relative path, derives containment from topic folders, and resolves `[[wikilinks]]`. Unresolved links remain visible instead of being guessed. Coordinates are never written into the workspace.

![Dusori dark knowledge graph showing portable learning artifacts](apps/site/public/app-graph.png)

```mermaid
flowchart LR
  F["Markdown + text files"] --> C["@dusori/core graph builder"]
  C --> G["Local SVG constellation"]
  C --> A["Accessible artifact index"]
  O["Obsidian"] <--> F
  Z["ZIP export"] <--> F
```

## Portable file contract

```text
<Dusori Root>/
├── Home.md
├── dusori.json
└── Topics/<topic-slug>/
    ├── Overview.md
    ├── roadmap.md
    ├── TUTOR.md
    ├── state.json
    ├── research.json               # created after the first dismissal
    ├── Notes/
    ├── Updates/YYYY/MM/YYYY-MM-DD.md
    ├── Sources/
    │   ├── manifest.json
    │   └── items/<hash>-<source-name>.md|txt
    └── Backups/
```

Markdown and text are user-owned. JSON is machine-owned, schema-versioned, and validated. If a Markdown file changed outside Dusori, that file stays active and Dusori writes a dated `.proposed-…` version beside it. Acceptance is always explicit and recorded in `Updates/`.

## Architecture

```text
apps/app                  SvelteKit browser/PWA workbench
apps/site                 Astro + Starlight product and documentation site
packages/core             Storage-neutral domain, learning loop, research, graph, conflicts
packages/storage-opfs     Private browser workspace adapter
packages/storage-fsa      User-approved folder adapter
packages/companion        Optional token-protected loopback research service
tests/e2e                 Built Pages artifact and user-flow verification
```

The browser app calls storage-neutral core modules. OPFS, the File System Access API, and memory tests implement the same storage interface; the optional companion is a separate, token-protected loopback transport for bounded research operations. There is no hosted application backend.

## Browser support

| Capability                | Chrome / Edge desktop | Firefox / Safari  | Mobile                      |
| ------------------------- | --------------------- | ----------------- | --------------------------- |
| Private browser workspace | Yes                   | Yes               | Yes¹                        |
| ZIP import/export         | Yes                   | Yes               | Yes                         |
| Direct folder connection  | Yes                   | No; use ZIP       | Chrome Android best-effort² |
| Offline after first load  | Yes                   | Yes¹              | Yes¹                        |
| Install                   | PWA                   | Add to Dock / tab | PWA / Home Screen           |

¹ Browser storage retention varies. Install where supported and keep exported backups.<br />
² Mobile folder writes are not atomic; ZIP remains the portability baseline.

## Develop and verify

Prerequisites: Node.js 24 LTS and pnpm 11.

```sh
corepack enable
pnpm install
pnpm check
pnpm test:e2e
```

Useful commands:

```sh
pnpm dev:app       # SvelteKit app
pnpm dev:site      # Astro/Starlight site
pnpm test:unit     # core, storage, and companion tests
pnpm build         # compose the exact GitHub Pages artifact
pnpm preview       # serve dist/pages locally
```

The optional companion can be built from this repository:

```sh
pnpm build
pnpm --filter dusori dev -- --root /path/to/Dusori
```

The v0.3.0 GitHub release includes the hosted browser app and companion source, but does not publish the companion to npm. `npx dusori` remains the intended public command after a separate npm release; for now, build it from this repository using the command above. The companion binds only to `127.0.0.1`, issues a new token for each run, removes that token from the browser address after connection, and stops with its terminal process.

**Compatibility note:** do not reopen a workspace containing a companion-upgraded source with v0.2.0. That older reader can rename `Sources/manifest.json` to an `.invalid-<timestamp>` file after seeing the newer provenance value. Source content remains untouched; update to v0.3.0 and rename the manifest back if this has already happened.

See [CHANGELOG.md](CHANGELOG.md), [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), the [architecture decisions](docs/adr/), and the [product specification](docs/product/spec.md).

## License

Dusori is released under the [Apache License 2.0](LICENSE). Bundled fonts retain their SIL Open Font License files under `apps/app/static/fonts/licenses/`.

## Acknowledgements

- [Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify) (MIT) for the constellation, link-affinity, and “god node” hub ideas.
- [tt-a1i/archify](https://github.com/tt-a1i/archify) (MIT) for the geometry self-audit idea.
- [chanhx/crabviz](https://github.com/chanhx/crabviz) (AGPL-3.0) for the focus-fade idea only; no code was copied or derived.

These ideas were reimplemented independently; no code was copied.
