# ADR-004: Loopback companion boundary

**Status:** accepted · **Date:** 2026-07-20

## Decision

Bind the optional companion only to `127.0.0.1`, authenticate every API request with a per-launch token, enforce an exact origin allowlist, and confine paths through canonicalization and realpath checks.

The first milestone implements health, session, and minimal root-confined file operations only.

## Consequences

Ollama, fetching, and scheduling cannot enter unnoticed. The process is session-scoped and exits with its terminal process.
