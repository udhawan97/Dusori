# Dusori companion

The optional Dusori companion serves the built web app from a loopback origin and exposes a token-protected, root-confined file API. It binds only to `127.0.0.1` and stops with its terminal process.

This package is not published in the workspace-foundation milestone. From the repository root:

```sh
pnpm install
pnpm build
pnpm --filter dusori dev -- --root /path/to/Dusori
```

The intended public command after an npm release is `npx dusori --root /path/to/Dusori`.

No Ollama, source fetching, scheduling, telemetry, or background daemon is included in this milestone.
