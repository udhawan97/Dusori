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

The first explicit review action creates `Topics/<topic-slug>/review.json`:

```json
{
  "schemaVersion": 1,
  "topicSlug": "topic-slug",
  "repetition": 2,
  "lastReviewedOn": "2026-07-21",
  "dueOn": "2026-07-28"
}
```

`review.json` is machine-owned, schema-validated, and written with the storage adapter's expected-hash guard. `repetition` indexes a fixed interval ladder (1, 3, 7, 14, 30, 60 days); `dueOn` is stored rather than derived so a future ladder change never moves an already-made promise. Dates are the device's local calendar dates — unlike the dated update files, which stay keyed to UTC calendar dates — so an interval lands on the day the learner actually experienced it. A conflicting write re-reads the current schedule and reapplies the recorded outcome on top of it. Older readers never open the file, and deleting it only forgets the schedule.

Upgrading a URL source's stub content to the fetched page's full text uses the same expected-hash guard, but the caller supplies the expected content hash directly, read from the source file immediately before the fetch. A URL source's recorded `sha256` is the hash of its URL — the manifest's dedupe key — not of its file content, so there is no content hash already on record to compare against. A mismatch between that freshly read hash and the file's current hash surfaces as the same conflict as any other stale write.

**2026-07 (v0.3.0):** `SourceRecord.origin.provider` and `origin.capturedVia` widened from closed enums to validated non-empty strings (known values: `mslearn`, `wikipedia`, `companion` / `catalog-reference`, `api-extract`, `page-extract`). A v0.2.0 reader that encounters `provider: 'companion'` fails its schema check and renames the manifest to `Sources/manifest.json.invalid-<timestamp>`. Nothing restores it: once that has happened, even an updated app reports the manifest as missing, and the topic's source library and ZIP export stay broken until the user renames the file back by hand. Source content files are never touched, so no material is lost. Avoid pointing a v0.2.0 build at a workspace an upgraded source has been written into — including a stale `npx dusori` companion serving its own bundled app copy. The widening makes this the last provenance value that can break a reader.
