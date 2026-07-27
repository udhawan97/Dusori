# Source-grounded review sessions — implementation plan

Design: [2026-07-27-source-grounded-review-design.md](../specs/2026-07-27-source-grounded-review-design.md)

Small commits, each one green on `pnpm test:unit` before the next starts.
Tests are written first in every commit that carries logic.

## Commit 1 — deterministic recall sessions in core

`packages/core/src/learning/recall.ts` + `recall.test.ts`, exported from
`packages/core/src/index.ts`.

- Tests first: excerpt extraction and bounding; readable-vs-URL-reference
  classification; round-robin diversity; 3–5 prompt band; stable ids and
  ordering; `no-sources`; `no-readable-sources` with its reference count;
  missing source file skipped; corrupt manifest surfaces the existing error.
- Then: `buildRecallSession`, reusing `readSourceManifest` and the storage
  adapter. No writes anywhere in this module.

## Commit 2 — the AI seam (pure halves first)

- Tests first for `recallAiRequest` (payload carries objective + bounded
  excerpts and nothing else) and `applyAiRecallPrompts` (accepts a
  well-formed reply; keeps deterministic prompts on wrong count, empty entry,
  over-long entry; never touches evidence, order, or count).
- Then the two pure functions in `recall.ts`.
- Then `CompanionAiClient.recallPrompts` in `research/ai.ts` with an abort
  timeout, plus client tests for success, non-200, unparsable body, timeout.

## Commit 3 — companion route

`packages/companion/src/ai.ts` gains `writeRecallPromptsWithAi`;
`src/routes/ai.ts` gains `POST /api/ai/recall-prompts`.

- Tests first in `ai.test.ts` and `server.test.ts`: zod rejection, success
  with an injected upstream fake, `not-configured` → 503, provider failure →
  502, and the existing auth/origin gates still applying to the new route.

## Commit 4 — `ReviewSession.svelte`

- New component: one prompt at a time, reveal-on-demand evidence, labelled
  prompt provenance, footer stating nothing is saved, Got it / Needs work as
  the only exit that changes anything, Close without rating everywhere else.
- `LearningLoop.svelte` gains a **Start review** action per queue item, an
  `ai` prop, and routes the session's rating through its existing
  `markReviewed` so `markTopicReviewed` keeps exactly one caller.
- `+page.svelte` passes the existing `companionAiClient` through.
- Keyboard, `aria-live`, focusable excerpt region, 320px layout, no new
  animation.

## Commit 5 — end-to-end journey

`tests/e2e/dusori.spec.ts`:

- Seed a pasted source, open Today, Start review, walk prompts, reveal
  evidence (asserting the local path is shown), rate Got it, assert the next
  due date and that `review.json` was written exactly once.
- A start-then-close session leaves no `review.json`.
- URL-reference-only topic shows the explain-and-do-not-fetch state.
- Keyboard-only pass with focus restored to the invoking button.
- 320px width without horizontal overflow; axe clean on the open dialog.

## Commit 6 — documentation and changelog

README product table row, `docs/product/spec.md` milestone entry, site docs,
`CHANGELOG.md` Unreleased, and the research-agent spec's program-order line
marked done. No release, no deploy.

## Verification

`pnpm check`, `DUSORI_PREVIEW_PORT=4174 pnpm test:e2e`,
`pnpm smoke:companion` (the companion route changes), `graphify update .`,
one scoped graphify query, and a rendered pass at desktop and 320px with
keyboard and reduced motion.
