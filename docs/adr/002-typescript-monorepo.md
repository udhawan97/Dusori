# ADR-002: TypeScript monorepo

**Status:** accepted · **Date:** 2026-07-20

## Decision

Use strict TypeScript, pnpm workspaces, SvelteKit for the PWA, Astro/Starlight for the public site, Fastify for the companion, and pure adapter-driven domain logic in `packages/core`.

Pin TypeScript 6.0.3 because the current SvelteKit, Astro check, and typescript-eslint toolchain does not support TypeScript 7 yet. Unsupported novelty is not “latest and greatest.”

## Consequences

One language covers browser, domain, and companion code. The optional companion currently requires Node.js 24; a single executable is future work.
