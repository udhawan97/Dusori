# ADR-004: Loopback companion boundary

**Status:** accepted · **Date:** 2026-07-20

## Decision

Bind the optional companion only to `127.0.0.1`, authenticate every API request with a per-launch token, enforce an exact origin allowlist, and confine paths through canonicalization and realpath checks.

The first milestone implements health, session, and minimal root-confined file operations only.

## Consequences

Ollama and scheduling cannot enter unnoticed. Every page fetch begins with an exact-host confirmation in the app. The process is session-scoped and exits with its terminal process.

**2026-07 update:** the "minimal root-confined file operations only" milestone is superseded. The companion now also exposes `/api/research/fetch` (SSRF-guarded readability extraction: blocked-address checks — covering private, reserved, and other non-public ranges, including IPv4 addresses embedded in IPv6 forms — on every redirect hop, a 3-hop redirect cap, HTML/plain-text content only, a 4 MiB fetch cap, and a 15 s timeout) and `/api/research/mslearn-search` (a hardcoded proxy for `learn.microsoft.com/api/search`). Both sit behind the same per-launch token and exact origin allowlist. Residual DNS-rebinding risk between address validation and connection is accepted for a loopback-bound, token-gated personal tool fetching user-chosen URLs.

**2026-07 v0.3.0 update:** `/api/health` identifies the service as `dusori-companion` with API version `1`; the app enables companion actions only after validating that contract. Launch credentials are consumed into memory and immediately removed from the address and current history entry while ordinary topic and view parameters are preserved.
