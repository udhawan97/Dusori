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
- contains no Ollama, fetching, scheduling, or telemetry behavior in the current milestone.

Imported Markdown is sanitized before rendering. Raw HTML is removed. Mermaid definitions use strict security mode and their rendered SVG is isolated inside a sandboxed iframe.

## Supported versions

Until the first tagged release, only the latest commit on `main` receives security fixes.
