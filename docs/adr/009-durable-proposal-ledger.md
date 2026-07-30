# ADR-009: Durable proposal lifecycle ledger

**Status:** accepted · **Date:** 2026-07-30

Pending proposal state is recorded in a schema-versioned, hash-guarded `Topics/<topic-slug>/proposals.json` ledger containing the target path, proposal path, creation time, and `pending`, `accepted`, or `kept` resolution. Filename scanning is rejected because proposal Markdown remains after resolution, while renaming or annotating that Markdown would break update-log links or alter the exact proposed content; the ledger preserves both versions untouched and gives Today reliable evidence for Needs attention.
