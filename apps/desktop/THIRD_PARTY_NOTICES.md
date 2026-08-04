# Third-party notices

Dusori is distributed under the Apache License 2.0. Its desktop bundles include open-source
software maintained by other projects. The exact resolved versions are recorded in
`pnpm-lock.yaml` and `apps/desktop/src-tauri/Cargo.lock` in the matching source release.

The packaged Node.js runtime is distributed under the MIT License and includes additional
third-party components. Its complete upstream license text is bundled beside the runtime as
`resources/NODE_LICENSE`.

The desktop shell directly uses Tauri (Apache-2.0 OR MIT), Tauri Updater (Apache-2.0 OR MIT),
Serde and Serde JSON (Apache-2.0 OR MIT), Rand (Apache-2.0 OR MIT), SHA-2 (Apache-2.0 OR MIT),
Hex (Apache-2.0 OR MIT), and Atomicwrites (MIT).

The bundled application and local companion directly use Svelte (MIT), SvelteKit (MIT),
Lucide (ISC), Mermaid (MIT), PDF.js (Apache-2.0), Unified/Remark/Rehype (MIT), Fastify and its
static/CORS plugins (MIT), Mozilla Readability (Apache-2.0), LinkeDOM (ISC), Zod (MIT), and the
Anthropic SDK (MIT). Bundled Shippori Mincho, Zen Kaku Gothic New, and IBM Plex Mono fonts are
licensed under the SIL Open Font License; their license files remain alongside the fonts.

Copyright remains with each project's contributors. Source code and the authoritative license
files are available from the corresponding dependency repositories identified by the lockfiles.
