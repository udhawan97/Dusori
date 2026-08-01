# Topic status is settable from Today

**Status:** approved · **Date:** 2026-08-01 · **Target release:** next

## Problem

Today's topic ledger renders each topic's status as inert text —
`<p class="status-label">{summary.status}</p>` — with a single **Open roadmap**
link beside it. Changing a status means opening that topic's roadmap, changing
it there, and navigating back.

The dead end is worse for a paused topic. Today routes a paused topic to
`open-topic`, and `onOpenTopic` is wired to `openToday(slug)`
(`apps/app/src/routes/+page.svelte:1134`), so the action returns the learner to
Today with the slug selected and nothing changed. The one lane whose job is to
route the next action cannot perform the action the product contract explicitly
grants it (`docs/product/spec.md:57`).

The controls already exist sixty lines away in the same component, in the
roadmap branch.

## Change

### One snippet, two call sites

The roadmap branch's `status-controls` group becomes a Svelte snippet taking the
topic it acts on:

```svelte
{#snippet statusControls(topic: TodayTopicSummary, qualify: boolean)}
```

The roadmap branch renders it with `qualify = false`; each Today ledger card
renders it with `qualify = true`.

`qualify` controls accessible naming only. On the roadmap there is one topic in
context, so the visible button text — Active, Paused, Complete — is the
accessible name, and the group is labelled `Topic status`. On Today there are N
cards and three identically-labelled buttons per card, so each button is named
`Active — <topic title>` and each group `Topic status — <topic title>`. The
visible text remains the first words of the accessible name, so the name still
contains the label.

### `changeStatus` takes the topic it changes

It currently closes over the module-level `topicSlug` and `selected`, which is
correct for exactly one card. It becomes
`changeStatus(topic: TodayTopicSummary, status)` and reads the slug, the current
status, and the title from its argument. The success message names the topic,
matching the review action's existing `Reviewed “<title>”.` voice.

### Work state is per topic

`statusWorking: boolean` becomes `statusWorkingSlug: string | null`. A card
disables only its own buttons while its write is in flight
(`disabled={statusWorkingSlug === topic.slug}`). With one card this is exactly
the previous behaviour; with N cards a write on one topic no longer freezes the
others. Two topics write to two different `state.json` files under their own
expected-hash guards, so concurrent changes are safe.

## What is reused unchanged

- `setTopicStatus` (`packages/core/src/learning/loop.ts:220`) — reads
  `state.json`, returns early when the status already matches, writes under
  `expectedHash`, and appends `- Paused this topic.` to the dated update log.
  No core change.
- The `<div class="feedback" aria-live="polite">` at
  `LearningLoop.svelte:637` sits outside both branches, so Today announces
  success and error already.
- `.status-controls` CSS is a component-scoped top-level rule, so it styles
  both call sites without a new selector.

## Out of scope

Rerouting the paused-topic `open-topic` action. That would change the
`ContinueLearningAction` union and its routing in `+page.svelte`. This slice
removes the reason a learner needs that route — a paused topic on Today now has
a Resume button — and the routing bug is filed separately.

## Testing

Test-first in `tests/e2e/dusori.spec.ts`, since the change is wiring rather than
logic and `setTopicStatus` is already unit-tested:

- Pausing a topic from its Today ledger card updates the card, announces the
  change naming the topic, and records it in the workspace recap, which reads
  the dated update file.
- Resuming from the same card returns the topic to active.
- The roadmap branch's unqualified button names are unchanged, which the
  existing learning-loop journey already asserts.
