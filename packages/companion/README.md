# Dusori companion

The optional Dusori companion serves the built web app from a loopback origin and exposes token-protected, root-confined file operations plus bounded research routes. It can fetch readable text from a URL only after the app confirms the exact host, and it can proxy Microsoft Learn's ranked search. It binds only to `127.0.0.1` and stops with its terminal process.

Run the published package with Node.js 24:

```sh
npx dusori@0.4.0 --root /path/to/Dusori
```

Folder access is off when `--root` is omitted. To build from the repository root instead:

```sh
pnpm install
pnpm build
pnpm --filter dusori dev -- --root /path/to/Dusori
```

`npx dusori@0.4.0 --help` and `--version` exit without starting a server. Each normal run creates a new bearer token. The app accepts a connection only after validating the companion health contract, then consumes the token into memory and removes it from the browser address and current history entry.

Page fetching rejects non-public destinations and revalidates every redirect, follows at most three redirects, accepts only HTML or plain text, stops at 4 MiB, and times out after 15 seconds. No Ollama, scheduling, telemetry, or background daemon is included in this release.
