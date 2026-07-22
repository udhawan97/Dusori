# Dusori companion

The optional Dusori companion serves the built web app from a loopback origin and exposes token-protected, root-confined file operations plus bounded research routes. It can fetch readable text from a URL only after the app confirms the exact host, and it can proxy Microsoft Learn's ranked search. It binds only to `127.0.0.1` and stops with its terminal process.

Run the published package with Node.js 24. `npx` downloads and starts it without a global install:

```sh
npx @udhawan97/dusori@latest
```

To approve one existing workspace folder for the session:

```sh
npx @udhawan97/dusori@latest --root "/path/to/Dusori"
```

Folder access is off when `--root` is omitted. To run a source clone instead, use `npm start` from the repository root; the first run installs the pinned dependencies and builds the app automatically.

`npx @udhawan97/dusori@latest --help` and `--version` exit without starting a server. Each normal run creates a new bearer token. The app accepts a connection only after validating the companion health contract, then consumes the token into memory and removes it from the browser address and current history entry.

Page fetching rejects non-public destinations and revalidates every redirect, follows at most three redirects, accepts only HTML or plain text, stops at 4 MiB, and times out after 15 seconds. No Ollama, scheduling, telemetry, or background daemon is included in this release.
