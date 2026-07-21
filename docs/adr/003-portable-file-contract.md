# ADR-003: Portable file contract

**Status:** accepted · **Date:** 2026-07-20 · **Research addition:** 2026-07-21

## Decision

Use portable Markdown and schema-versioned JSON as the only durable product data. Topic update histories live inside each topic so a moved topic remains self-contained.

Before writing user-owned Markdown, compare the current hash to the last-seen hash. A mismatch preserves the external file and creates a dated proposal. Never use last-write-wins.

## Consequences

The workspace is inspectable and editor-independent. Storage adapters must preserve identical logical paths and conditional-write behavior.

## Web-research addition

The source manifest remains at schema version 1 and accepts one additive optional `origin` object:

```json
{
  "provider": "mslearn | wikipedia",
  "capturedVia": "catalog-reference | api-extract",
  "capturedAt": "ISO-8601 datetime"
}
```

Research captures keep `method: "url"`; their source body is enriched content, while SHA-256 deduplication continues to use the canonical URL. Manual URL references keep their original unfetched-reference body and have no `origin` field.

The first dismissed suggestion creates `Topics/<topic-slug>/research.json`:

```json
{
  "schemaVersion": 1,
  "topicSlug": "topic-slug",
  "dismissed": [{ "key": "wikipedia:44779164", "title": "Title", "at": "ISO-8601 datetime" }]
}
```

`research.json` is machine-owned, schema-validated, and written with the storage adapter's expected-hash guard. A conflicting dismissal write is re-read and merged; it never uses last-write-wins.
