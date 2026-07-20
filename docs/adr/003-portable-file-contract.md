# ADR-003: Portable file contract

**Status:** accepted · **Date:** 2026-07-20

## Decision

Use portable Markdown and schema-versioned JSON as the only durable product data. Topic update histories live inside each topic so a moved topic remains self-contained.

Before writing user-owned Markdown, compare the current hash to the last-seen hash. A mismatch preserves the external file and creates a dated proposal. Never use last-write-wins.

## Consequences

The workspace is inspectable and editor-independent. Storage adapters must preserve identical logical paths and conditional-write behavior.
