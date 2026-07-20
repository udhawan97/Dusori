# ADR-006: Static GitHub Pages hosting

**Status:** accepted · **Date:** 2026-07-20

## Decision

Compose the Astro site at `/dusori/`, Starlight documentation at `/dusori/docs/`, and the SvelteKit PWA at `/dusori/app/` into one GitHub Pages artifact.

Do not depend on custom response headers. The service worker is emitted inside the application scope and the CSP is expressed in page metadata.

## Consequences

Hosting remains free for the public repository. Routing, manifests, offline behavior, and the project base path require explicit integration tests.
