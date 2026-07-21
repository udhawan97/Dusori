# Dusori companion

The optional Dusori companion serves the built web app from a loopback origin and exposes a token-protected, root-confined file API. It binds only to `127.0.0.1` and stops with its terminal process.

The v0.1.0 GitHub release does not publish this package to npm. From the repository root:

```sh
pnpm install
pnpm build
pnpm --filter dusori dev -- --root /path/to/Dusori
```

The intended public command after a separate npm release is `npx dusori --root /path/to/Dusori`.

No Ollama, source fetching, scheduling, telemetry, or background daemon is included in this milestone.
