# ADR-001: Dual execution model

**Status:** accepted · **Date:** 2026-07-20

## Decision

Ship one static PWA with a universal browser-workspace baseline, optional direct folder access on supported Chromium browsers, and an optional local companion for capabilities browsers cannot provide consistently.

The companion also serves the built app from its own origin so Safari can use future local capabilities without HTTPS-to-loopback mixed-content requests.

## Consequences

The hosted app remains useful without installation. Browser parity is documented as a capability matrix rather than implied. No hosted application backend is introduced.
