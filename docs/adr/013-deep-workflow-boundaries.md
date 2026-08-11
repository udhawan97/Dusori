# ADR-013: Deep workflow boundaries

## Status

Accepted 2026-08-11.

## Decision

Keep provider adapters as the external research seam, but register their availability, consent
scope, routing audience, evidence lens, capture policy, and browser origins in one provider catalog.
After the interface has received every required consent, run the full search-to-brief transaction
through `runResearchSequence`; presentation observes progress but does not own ordering or commits.

Project the complete Today screen through the read-only `projectToday` operation. Decide workspace
view transitions and URLs through the pure `transitionWorkspaceNavigation` operation, while document
reads, browser history, scroll, and focus remain at the Svelte page edge.

## Why

The former UI components coordinated the same workflow policies independently. Research capture,
provider readiness, Today derivation, and navigation resets could drift because callers had to know
too much about their implementation order. These four boundaries hide that choreography behind
domain-specific operations without adding a generic workflow engine, plugin system, or effect layer.

## Consequences

- Provider additions have one registration record and parity tests for hosted and desktop network
  policy.
- A research run preserves partial successes, capture failures, provenance, quoted-evidence rules,
  deterministic AI fallback, and edited-brief proposals through one interface.
- Today consumers receive one clock-consistent snapshot that performs no writes.
- Workspace navigation has table-tested topic, path, URL, history, and new-topic invariants.
- Consent dialogs, storage access, browser history, focus, and rendering remain explicit edge
  responsibilities.
