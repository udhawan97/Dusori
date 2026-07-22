<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/site/public/brand/dusori-mark-animated-reversed.svg">
    <source media="(prefers-color-scheme: light)" srcset="apps/site/public/brand/dusori-mark-animated.svg">
    <img src="apps/site/public/brand/dusori-mark-animated.svg" alt="Dusori" width="240">
  </picture>
</p>

<h1 align="center">Dusori</h1>

<p align="center"><em>A second brain should remember who owns the first.</em></p>

<p align="center">
  A private learning workbench built from your Markdown and JSON.<br>
  No account · no telemetry · no hosted database · useful without AI
</p>

<p align="center">
  <a href="https://udhawan97.github.io/Dusori/app/"><strong>Open Dusori</strong></a>
  ·
  <a href="https://udhawan97.github.io/Dusori/">Website</a>
  ·
  <a href="https://udhawan97.github.io/Dusori/docs/">Documentation</a>
</p>

<p align="center">
  <a href="https://github.com/udhawan97/Dusori/releases/latest"><img src="https://img.shields.io/github/v/release/udhawan97/Dusori?style=flat-square&color=cb4832" alt="Latest release"></a>
  <a href="https://github.com/udhawan97/Dusori/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/udhawan97/Dusori/ci.yml?branch=main&style=flat-square&label=CI" alt="CI"></a>
  <img src="https://img.shields.io/badge/Node.js-24_LTS-5FA04E?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 24 LTS">
  <img src="https://img.shields.io/badge/Svelte-5-FF3E00?style=flat-square&logo=svelte&logoColor=white" alt="Svelte 5">
  <img src="https://img.shields.io/badge/app-PWA-5A0FC8?style=flat-square&logo=pwa&logoColor=white" alt="Progressive Web App">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-2f6f62?style=flat-square" alt="Apache 2.0 License"></a>
</p>

<p align="center">
  <a href="#install-it-your-way">🚀 Install</a> ·
  <a href="#what-dusori-does">🧠 Features</a> ·
  <a href="#obsidian-without-surrendering-the-vault">💎 Obsidian</a> ·
  <a href="#for-developers">🛠️ Developers</a>
</p>

---

## Install It Your Way

Pick the amount of local control you want. The browser app and local companion open the same Dusori workspace experience.

|                        | 🌐 Install the PWA                                     | 🧠 Run the local companion                        | 🛠️ Run from source              |
| ---------------------- | ------------------------------------------------------ | ------------------------------------------------- | ------------------------------- |
| **Best for**           | Learning immediately                                   | Local page capture and one-folder access          | Contributing or inspecting it   |
| **You need**           | A modern browser                                       | Node.js 24 LTS                                    | Git and Node.js 24 LTS          |
| **Data location**      | Browser storage or approved folder                     | Browser storage or one explicitly approved folder | Same local storage choices      |
| **Background service** | None                                                   | Only while its terminal is open                   | Only while its terminal is open |
| **Start here**         | [Open Dusori](https://udhawan97.github.io/Dusori/app/) | `npx @udhawan97/dusori@latest`                    | `npm start` after cloning       |

<details open>
<summary><strong>🌐 Install the PWA — no terminal, account, or download</strong></summary>

<br>

1. [Open Dusori](https://udhawan97.github.io/Dusori/app/).
2. Use your browser’s **Install**, **Add to Dock**, or **Add to Home Screen** action.
3. Create a private browser workspace and export a ZIP after meaningful work.

Dusori works offline after its first successful load. Chrome and Edge on desktop can also connect one user-approved folder; Firefox and Safari use browser storage plus ZIP import/export.

</details>

<details>
<summary><strong>🧠 Run locally — one command (macOS · Windows · Linux)</strong></summary>

<br>

Install [Node.js 24 LTS](https://nodejs.org/en/download), then run:

```bash
npx @udhawan97/dusori@latest
```

Dusori opens automatically on a random `127.0.0.1` port. Nothing is installed as a background daemon, and closing the terminal stops the companion.

To approve one existing workspace folder for that session:

```bash
npx @udhawan97/dusori@latest --root "/path/to/Dusori"
```

Want a permanent `dusori` command instead of `npx`?

```bash
npm install --global @udhawan97/dusori@latest
dusori
```

</details>

<details>
<summary><strong>🛠️ Run from source — one cross-platform setup path</strong></summary>

<br>

```bash
git clone https://github.com/udhawan97/Dusori.git
cd Dusori
npm start
```

On the first run, `npm start` downloads the repository-pinned pnpm version, installs dependencies, builds the browser app and companion, then opens Dusori. Later starts reuse that local build.

Use `npm run setup` to install and build without launching. After pulling new source, run it once to refresh the local build.

</details>

## What Dusori Does

Dusori turns ordinary files into a private learning loop. Start in browser storage or connect one folder, then take the whole workspace elsewhere as a ZIP whenever you want.

|     | You do this                       | Dusori gives you                                                                                   |
| --- | --------------------------------- | -------------------------------------------------------------------------------------------------- |
| 🗺️  | Check roadmap objectives          | A deterministic next-review order, progress, topic state, and seven-day recap                      |
| 🔁  | Mark a topic reviewed             | An optional spaced schedule — 1, 3, 7, 14, 30, then 60 days — that rests the topic until it is due |
| ✍️  | Create or edit Markdown notes     | Portable notes with explicit proposals when another editor changed the same file first             |
| 🔎  | Search your workspace             | Case- and accent-insensitive local search with no hidden index or network request                  |
| 🔗  | Add `[[wikilinks]]`               | Backlinks, unresolved-link checks, and a deterministic knowledge constellation                     |
| 📚  | Save sources                      | Paste, local file, URL reference, provenance, and preview-first acceptance                         |
| 🧭  | Import a study guide              | A reviewable roadmap that preserves the original outline in `Sources/`                             |
| 🧪  | Open the optional companion       | Confirmed readable-page capture and bounded Microsoft Learn search through a loopback-only service |
| 📦  | Export or replace a workspace ZIP | Validation before confirmation plus rollback if a replacement write fails                          |

Key-based or general web search, Ollama transforms, and unattended work are roadmap items—not current features. Review scheduling exists only for topics you explicitly mark reviewed; Dusori generates no calendar, notification, or background work.

<p align="center">
  <img src="apps/site/public/app-workspace.png" alt="Dusori workspace showing the local learning loop" width="820">
  <br>
  <sub><em>Today, Roadmap, local notes, source provenance, and review state stay together without becoming a hosted account.</em></sub>
</p>

## Obsidian, Without Surrendering the Vault

Dusori uses Obsidian’s durable interface: folders, Markdown, frontmatter, and wikilinks. No plugin is required.

<details open>
<summary><strong>💎 Connect a dedicated Dusori folder</strong></summary>

<br>

1. Open or create an Obsidian vault.
2. Create `<Vault>/Dusori/`.
3. In Chrome or Edge on desktop, choose **Use Dusori with Obsidian**.
4. Select only the `Dusori` subfolder—never the whole vault.

Firefox and Safari use the private browser workspace plus ZIP import/export. Folder access is an enhancement; portable files remain the baseline.

</details>

## Local-First by Construction

<details open>
<summary><strong>🔐 What stays local—and what can use the network</strong></summary>

<br>

- Notes, roadmaps, state, search, graph layout, backlinks, and health checks stay in the current local workspace.
- The hosted app has no account system, telemetry, hosted application backend, or database.
- Microsoft Learn and English Wikipedia suggestions call their public APIs only when you use research.
- The optional companion fetches a URL only after you confirm its exact host. It rejects non-public destinations, rechecks redirects, and stops with the terminal process.
- The companion binds only to `127.0.0.1`, creates a fresh session token, and removes that token from the browser address after connection.

</details>

<details>
<summary><strong>📁 Portable file contract</strong></summary>

<br>

```text
<Dusori Root>/
├── Home.md
├── dusori.json
└── Topics/<topic-slug>/
    ├── Overview.md
    ├── roadmap.md
    ├── TUTOR.md
    ├── state.json
    ├── research.json
    ├── review.json
    ├── Notes/
    ├── Updates/YYYY/MM/YYYY-MM-DD.md
    ├── Sources/
    │   ├── manifest.json
    │   └── items/<hash>-<source-name>.md|txt
    └── Backups/
```

Markdown and text are user-owned. JSON is machine-owned, schema-versioned, and validated. If a Markdown file changed outside Dusori, that file stays active and Dusori writes a dated `.proposed-…` version beside it for explicit review.

</details>

<details>
<summary><strong>🌌 The graph remains files</strong></summary>

<br>

`@dusori/core` scans readable workspace files, derives topic containment, and resolves `[[wikilinks]]`. Backlinks reverse those resolved edges. Coordinates and health state are never written into the workspace, and there is no graph database.

```mermaid
flowchart LR
  files["Markdown + text files"] --> core["@dusori/core graph builder"]
  core --> graph["Local SVG constellation"]
  core --> index["Accessible artifact index"]
  obsidian["Obsidian"] <--> files
  zip["ZIP export"] <--> files
```

<p align="center">
  <img src="apps/site/public/app-graph.png" alt="Dusori dark knowledge graph showing portable learning artifacts" width="820">
</p>

</details>

## Browser Support

| Capability                | Chrome / Edge desktop | Firefox / Safari  | Mobile                      |
| ------------------------- | --------------------- | ----------------- | --------------------------- |
| Private browser workspace | Yes                   | Yes               | Yes¹                        |
| ZIP import/export         | Yes                   | Yes               | Yes                         |
| Direct folder connection  | Yes                   | No; use ZIP       | Chrome Android best-effort² |
| Offline after first load  | Yes                   | Yes¹              | Yes¹                        |
| Install                   | PWA                   | Add to Dock / tab | PWA / Home Screen           |

¹ Browser storage retention varies. Install where supported and keep exported backups.<br>
² Mobile folder writes are not atomic; ZIP remains the portability baseline.

## For Developers

Dusori is a TypeScript monorepo with a storage-neutral core and separate browser, site, storage, and loopback boundaries.

<details open>
<summary><strong>🛠️ Setup, run, and quality checks</strong></summary>

<br>

```bash
# Easiest cross-platform local build (Node.js 24 LTS only)
npm run setup
npm start

# Contributor workflow (Node.js 24 LTS + pnpm 11)
pnpm install
pnpm dev:app
pnpm check
pnpm test:e2e
```

`npm run setup` uses the exact pnpm version pinned in `package.json`; it does not require Corepack or a global pnpm install.

</details>

<details>
<summary><strong>🏗️ Architecture and project layout</strong></summary>

<br>

```text
apps/app                  SvelteKit browser/PWA workbench
apps/site                 Astro + Starlight product and documentation site
packages/core             Storage-neutral learning, research, graph, and conflict domain
packages/storage-opfs     Private browser workspace adapter
packages/storage-fsa      User-approved folder adapter
packages/companion        Optional token-protected loopback app and research service
scripts/local.mjs         Cross-platform source setup and local launcher
tests/e2e                 Built Pages artifact and user-flow verification
```

The browser app calls storage-neutral core modules. OPFS, the File System Access API, and memory tests implement the same storage interface. The optional companion is a separate transport for root-confined files and bounded research operations; there is no hosted application backend.

</details>

<details>
<summary><strong>📦 Build and inspect the published companion</strong></summary>

<br>

```bash
pnpm build
pnpm smoke:companion
npx @udhawan97/dusori@latest --help
npx @udhawan97/dusori@latest --version
```

The package smoke check packs a real tarball, runs its CLI through npm, and verifies that the app shell and service worker are included.

</details>

## Troubleshooting

<details>
<summary><strong>Common install and first-run issues</strong></summary>

<br>

| Symptom                                                 | Fix                                                                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `Dusori requires Node.js 24 LTS`                        | Install [Node.js 24 LTS](https://nodejs.org/en/download), open a new terminal, and retry.                           |
| `npx` asks to install the package                       | Confirm once; npm is downloading the published Dusori companion.                                                    |
| Browser did not open                                    | Open the `http://127.0.0.1:…` URL printed in the terminal.                                                          |
| Folder access is off                                    | Restart with `--root "/path/to/Dusori"`; only that folder is approved.                                              |
| Direct folder button is unavailable                     | Use desktop Chrome or Edge, or use browser storage with ZIP import/export.                                          |
| Workspace was created with v0.3.0+ but opened in v0.2.0 | Update first. The older reader can rename a newer `Sources/manifest.json`; source content itself remains untouched. |

More help: [Getting started](https://udhawan97.github.io/Dusori/docs/getting-started/) · [Browser support](https://udhawan97.github.io/Dusori/docs/browser-support/) · [Security policy](SECURITY.md)

</details>

## Release Notes

The current `v0.4.0` release adds conflict-safe Markdown note authoring, local full-text search, backlinks, explicit workspace health, a deterministic review queue, and a seven-day recap. ZIP replacement validates the complete archive before confirmation and rolls back if a write fails.

[Read the v0.4.0 notes](https://github.com/udhawan97/Dusori/releases/tag/v0.4.0) · [Review the changelog](CHANGELOG.md)

## Contributing

Issues and pull requests are welcome. Preserve the portable file contract, offline baseline, conflict safety, explicit network consent, and honest capability reporting. See [CONTRIBUTING.md](CONTRIBUTING.md) before changing a storage or network boundary.

## License

Released under the [Apache License 2.0](LICENSE). Bundled fonts retain their SIL Open Font License files under `apps/app/static/fonts/licenses/`.

## Acknowledgements

- [Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify) (MIT) for constellation, link-affinity, and “god node” ideas.
- [tt-a1i/archify](https://github.com/tt-a1i/archify) (MIT) for the geometry self-audit idea.
- [chanhx/crabviz](https://github.com/chanhx/crabviz) (AGPL-3.0) for the focus-fade idea only; no code was copied or derived.

<p align="center">
  <sub>Your files stay useful with or without Dusori. That is the point.</sub>
</p>
