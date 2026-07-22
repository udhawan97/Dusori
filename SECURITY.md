# Security policy

Report a vulnerability through GitHub’s private vulnerability reporting for the `udhawan97/Dusori` repository. Do not include private workspace contents in a public issue.

## Security boundary

The hosted Dusori application is static. It has no hosted application backend, accounts, telemetry, analytics, or cloud database.

The optional local companion:

- binds only to `127.0.0.1` on a random free port;
- generates a new high-entropy token for every process run;
- requires that token on every API request;
- permits only its own origin and the configured hosted origin—never wildcard CORS;
- confines file operations to the root passed through `--root`;
- rejects parent traversal, absolute paths, and symlinks resolving outside that root;
- performs atomic same-directory writes;
- leaves no daemon running after the process exits;
- contains no Ollama or telemetry behavior in the current milestone;
- fetches a page only when the user confirms that exact host, validating every address and redirect hop against private, reserved, and other non-public ranges;
- creates no schedule of its own: review due dates come only from explicit in-app review actions, and nothing runs while the app is closed.

Imported Markdown is sanitized before rendering. Raw HTML is removed. Mermaid definitions use strict security mode and their rendered SVG is isolated inside a sandboxed iframe.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.5.x   | Yes       |

Security fixes target the latest `0.5.x` release and `main`. Older releases and prerelease snapshots are not supported.
