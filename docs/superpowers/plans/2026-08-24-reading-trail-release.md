# Reading trail and v0.14.0 release plan

## Goal

Complete the high-confidence post-discovery phase: help a researcher find a saved source, move
through local reading copies, and preserve an exact passage in a learner-owned note. Publish the
verified result as v0.14.0 without changing the workspace schema, provider consent, or release
trust boundaries.

## Invariants

- Shelf search and filters are local projections and persist nothing.
- Previous/next navigation follows active manifest order and marks no progress.
- A selected quote is bounded to 1,200 characters and copied verbatim after whitespace
  normalization; Dusori adds no generated claim.
- A source-grounded note records source path, current content SHA-256, and nearest heading before
  the note editor opens.
- Later source edits never rewrite a saved quote or learner annotation.
- Additional research candidates still require one explicit **Approve and add** action and reuse
  only an already-consented provider.
- Browser storage restoration remains fail-closed; unrelated `.remember/**` state is never staged.

## Implementation order

1. Add pure source shelf, evidence-state, passage-normalization, and note-template helpers with unit
   tests.
2. Add local shelf search and All/Evidence/References lenses.
3. Add the Reading room rail and selection-aware note creation.
4. Add built-artifact browser coverage for filter, next-source, selection, persisted metadata,
   accessibility, and responsive containment.
5. Synchronize the product contract, roadmap, README, source guide, screenshots, versions,
   changelog, and release notes.
6. Run Node 24 `pnpm check`, the full browser suite, package/security/desktop configuration gates,
   and Graphify incremental update plus a scoped query.
7. Commit exact verified files, push `main`, wait for green CI/Pages, tag the same commit as
   `v0.14.0`, verify the draft assets and checksums, publish the release, then verify npm and live
   public surfaces.

## Stop conditions

Do not tag or publish if the graph refresh/query, full check, browser suite, package audit, desktop
release configuration, exact-SHA alignment, or draft-asset checksum gate fails. Do not include,
discard, or overwrite `.remember/**` or any other unrelated user-owned change.
