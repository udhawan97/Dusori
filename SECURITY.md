# Security policy

Report a vulnerability through GitHub’s private vulnerability reporting for `udhawan97/Dusori`. Do not place private workspace contents, credentials, companion output, or update keys in a public issue.

## Hosted application

The hosted Dusori app is static. It has no application backend, account system, analytics, telemetry, or cloud workspace database. Browser workspaces are origin-private local storage; supported folder connections and ZIP export/import remain user-controlled.

## Loopback companion and desktop sidecar

The companion:

- binds only to `127.0.0.1` on a random port;
- generates a fresh high-entropy credential for every process;
- never places that credential in the opened URL, stdout, or logs;
- gives its bundled same-origin app an HttpOnly, SameSite cookie and accepts an Authorization bearer for explicit API clients;
- runs desktop API-only mode only with an environment-provided token and exact desktop origin;
- never enables wildcard CORS;
- confines file operations to the root explicitly passed for that session;
- rejects parent traversal, absolute paths, and symlinks that resolve outside the root;
- uses guarded/atomic writes and preserves conflicting Markdown as a proposal;
- leaves no ordinary background daemon after the process exits.

Page capture requires confirmation of the exact host. Every address and redirect is checked against private, reserved, loopback, link-local, and otherwise non-public destinations. Response type, size, redirects, and duration are bounded.

## Untrusted content

Imported Markdown is sanitized before rendering. Raw HTML is removed. Mermaid runs in strict mode and its rendered output is isolated. Generated learning pages opened in Dusori use a sandbox without the app’s origin, workspace storage, or cookies.

Remote source text is data, not instructions. Optional AI egress is separately consented and model-labeled. Provider credentials remain in the companion environment and should never be added to workspace files.

## Desktop updates

Release builds embed only the updater public key. Private signing material belongs in the protected GitHub `release` environment. The desktop app accepts metadata only from the project’s fixed GitHub Releases `latest.json` endpoint, limits downloads to 512 MiB, verifies the platform artifact signature, and refuses installation when the offered version changed or work is unsaved.

The v0.14.0 macOS and Windows installers are not Apple-notarized or Microsoft code-signed. Users should download them only from the official GitHub release and verify `SHA256SUMS.txt`. The in-app updater signature is a separate trust mechanism and does not suppress Gatekeeper or SmartScreen warnings.

## Scheduling boundary

Dusori creates no calendar events, notifications, closed-app research, or unattended update installation. Review dates change only through explicit review outcomes. A topic freshness scan can run only when the user opens an armed topic, at most once per session.

## Supported versions

| Version          | Supported                        |
| ---------------- | -------------------------------- |
| 0.12.x           | Yes                              |
| 0.11.x and older | No; update to the latest release |

Security fixes target the latest published release and `main`.
