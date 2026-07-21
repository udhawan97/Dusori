# Dusori

<p align="center">
  <img src="apps/site/public/brand/dusori-lockup.svg" width="420" alt="Dusori" />
</p>

Dusori is a free, open-source, local-first learning workspace. It creates plain Markdown and JSON that remains readable in any editor, including Obsidian, and it works without an account, hosted database, telemetry, or AI.

The current workspace-foundation milestone includes browser storage, direct folder access on supported Chromium desktop browsers, ZIP portability, conflict-safe proposals, sanitized note rendering, offline reloads, a local source library, and preview-first curriculum import. Paste an English Microsoft Learn study guide or a structured Markdown syllabus; Dusori extracts the outline locally, shows the roadmap before writing, and stores the original beside the topic. Remote source fetching, web search, Ollama, AI transformation, and unattended scheduling are roadmap items—not shipped features.

## Try Dusori

- Web app: <https://udhawan97.github.io/Dusori/app/>
- Documentation: <https://udhawan97.github.io/Dusori/docs/>
- Product page: <https://udhawan97.github.io/Dusori/>

The optional companion is implemented and can be built locally:

```sh
corepack enable
pnpm install
pnpm build
pnpm --filter dusori dev -- --root /path/to/Dusori
```

The intended public command is `npx dusori --root /path/to/Dusori`, but the npm package has not been published in this milestone. The README will not claim that command works until an npm release exists.

## Browser capabilities

| Capability                       | Chrome/Edge desktop                 | Chrome Android | Firefox desktop           | Safari macOS                    | Safari iOS         |
| -------------------------------- | ----------------------------------- | -------------- | ------------------------- | ------------------------------- | ------------------ |
| Browser workspace (OPFS)         | Yes                                 | Yes            | Yes                       | Yes¹                            | Yes¹               |
| ZIP import/export                | Yes                                 | Yes            | Yes                       | Yes                             | Yes                |
| Connect a real folder            | Yes                                 | Yes²           | No → import/export        | No → import/export              | No                 |
| Companion from hosted origin     | Local-network permission may appear | Not supported  | Supported                 | Blocked by mixed-content policy | Not supported      |
| Companion from its localhost URL | Yes                                 | Not supported  | Yes                       | Yes                             | Not supported      |
| Ollama                           | Future via companion                | Not supported  | Future via companion      | Future via companion localhost  | Not supported      |
| Install                          | PWA                                 | PWA            | Tab + service worker only | Add to Dock                     | Add to Home Screen |
| Offline after first load         | Yes                                 | Yes            | Yes                       | Yes¹                            | Yes¹               |
| Closed-app scheduling            | No                                  | No             | No                        | No                              | No                 |

¹ Safari storage retention can be less predictable for a site used only in a browser tab. Install the web app where supported and keep exported backups.

² Chrome Android 132+ exposes folder access, but its writes are not atomic. Dusori treats it as best-effort and keeps import/export as the portability baseline.

Folder access is a capability enhancement, not a universal promise. When connecting an Obsidian vault, select or create `<Vault>/Dusori/`; Dusori never needs access to the rest of the vault and does not install a plugin.

## File contract

```text
<Dusori Root>/
├── Home.md
├── dusori.json
└── Topics/<topic-slug>/
    ├── Overview.md
    ├── roadmap.md
    ├── TUTOR.md
    ├── state.json
    ├── Notes/
    ├── Updates/YYYY/MM/YYYY-MM-DD.md
    ├── Sources/
    │   ├── manifest.json
    │   └── items/<hash>-<source-name>.md|txt
    └── Backups/
```

Markdown and text sources are user-readable. JSON is machine-owned, schema-versioned, and validated. Adding a source records its hash, local path, method, size, and optional original URL or filename in `Sources/manifest.json`, then appends the event to that topic’s dated update log. If an externally edited Markdown file no longer matches Dusori’s last-seen hash, the external file stays untouched and Dusori writes a dated `.proposed-…` file beside it.

Curriculum import is offline and explicit: open the inspector, paste a supported outline, preview the extracted hierarchy, then choose **Apply roadmap**. Microsoft Learn recognition currently targets the English `Skills measured` heading; the structured Markdown adapter accepts ordinary headings and lists in any language. Inputs are capped at 512 KiB and 200 roadmap items. Dusori never fetches the optional source URL.

## Development

Prerequisites: Node.js 24 LTS and pnpm 11.

```sh
corepack enable
pnpm install
pnpm check
```

Useful commands:

```sh
pnpm dev:app       # SvelteKit app
pnpm dev:site      # Astro/Starlight site
pnpm test:unit     # domain and companion tests
pnpm test:e2e      # built Pages artifact in Chromium
pnpm build         # compose dist/pages
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and the [architecture decisions](docs/adr/).

## License

[Apache License 2.0](LICENSE). Bundled fonts retain their SIL Open Font License files under `apps/app/static/fonts/licenses/`.
