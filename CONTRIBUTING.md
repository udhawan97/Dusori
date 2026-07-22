# Contributing to Dusori

Dusori is maintained as a small, local-first project. A useful contribution should preserve the file contract, offline baseline, honest capability reporting, and the absence of hidden network behavior.

## Setup

Use Node.js 24 LTS. The cross-platform helper downloads the repository-pinned pnpm version, installs dependencies, and builds the local app:

```sh
npm run setup
```

For day-to-day development, use pnpm 11:

```sh
pnpm dev:app
pnpm check
pnpm test:e2e
```

## Change discipline

- Keep `packages/core` free of DOM, Node filesystem, framework, and provider imports.
- Add storage behavior through the `StorageAdapter` boundary.
- Treat imported Markdown, source material, and future AI output as untrusted.
- Never add telemetry, a hosted backend, paid infrastructure, an always-running service, or automatic remote egress without an explicit product decision.
- Never convert planned features into shipped README or website claims.
- Include tests for persistence, conflict safety, portability, security boundaries, or accessibility when a change touches them.
- Verify rendered changes at 320, 375, 414, 768, and desktop widths.

Small pull requests with one coherent outcome are easiest to review.
