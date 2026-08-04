# ADR-011: Consent-gated providers and lawful capture limits

**Status:** accepted · **Date:** 2026-08-04

## Decision

Treat every external provider as a separate capability with its own disclosure, availability state, run outcome, configuration, and capture policy. No provider runs before device-local consent. Credentialed services use only operator-supplied companion environment variables.

Dusori does not bypass authentication, paywalls, robots controls, private-address checks, or platform restrictions. YouTube discovery prefers the official Data API v3 through a user-supplied `YOUTUBE_API_KEY`; an optional self-hosted `INVIDIOUS_URL` is the fallback. Both are metadata/reference-only: the companion may proxy the thumbnail, but it does not download video, audio, or captions. Transcript text enters through the ordinary Paste/File path only when the learner supplied it, owns it, or has permission.

Provider availability is not a research result. A configured provider can still fail, and `research.json` records that failure separately from a valid empty response.

## Why

- “Can call” and “found nothing” are materially different facts for research trust.
- Social/video platforms have changing terms, quotas, and technical access rules.
- Open-source software cannot promise that third-party free tiers remain free or available.
- Reference-only capture avoids turning a learning tool into a media-downloading or transcript-harvesting service.

## Consequences

- Documentation carries a provider matrix naming configuration and responsibility.
- A candidate may be useful as provenance even when its text is not locally readable.
- Source-grounded synthesis and review report unreadable references rather than silently counting them as evidence.
- New providers require a disclosure, typed outcome, bounded capture implementation, fixtures, legal-boundary review, and documentation before they enter the registry.
