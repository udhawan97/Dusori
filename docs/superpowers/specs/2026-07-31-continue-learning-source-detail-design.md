# Continue learning names its source gap

**Status:** approved · **Date:** 2026-07-31 · **Target release:** next

## Problem

`inspectSourceReadiness` (`packages/core/src/learning/recall.ts:156`) returns
`{ approvedSources, readableSources, sourceReady }`. `buildTodayFocus`
(`packages/core/src/learning/today-focus.ts:152`) calls it for every summary and
keeps only the boolean. Today's **Continue learning** card therefore renders one
of two phrases — `local source ready` or `research needed`.

Two different situations collapse into `research needed`:

- The topic has no sources at all. Running a discovery scan is the right next
  step.
- The topic has approved sources, but none of them hold readable text on this
  device — URL references kept without a capture, for example. Another discovery
  scan finds nothing new; what the learner needs is **Fetch full content** or a
  paste.

The card sends both to Research, so the second case is a dead end the learner
can only escape by guessing.

## Change

`ContinueLearningItem` loses `sourceReady: boolean` and gains
`sourceDetail: string`, derived from the readiness record already loaded:

| Readiness                            | `sourceDetail`                                  |
| ------------------------------------ | ----------------------------------------------- |
| `readableSources > 0`                | `local source ready`                            |
| `approvedSources > 0`, none readable | `3 sources saved, none readable on this device` |
| no manifest, invalid, or empty       | `no sources yet`                                |

The second row is singular at one: `1 source saved, none readable on this device`.

`LearningLoop.svelte:342-346` renders `item.sourceDetail` in place of its
ternary. Nothing else changes.

## Why a string, not a union plus a count

`ContinueLearningItem` already carries `reason`, a core-produced user-facing
phrase rendered raw on the same line, and `buildTodayFocus` already composes
`title` and `detail` copy for every `NeedsAttentionItem`. A phrase is the shape
this function already returns. It keeps the change to one field, needs no new
app-layer module or test file, and stays assertable in `today-focus.test.ts`.

`sourceReady` is removed rather than kept alongside, because
`sourceDetail === 'local source ready'` is the same fact and the boolean has
exactly one consumer — the line being replaced. `actionFor` and `canStartReview`
keep using the local `sourceReady` variable inside `buildTodayFocus`, so routing
is unchanged.

## Honesty constraint

`approvedSources` is the full manifest length. `readableSources` counts only the
first twelve sources, because `inspectSourceReadiness` reads
`sources.slice(0, maxSourceReads)` (`recall.ts:15`). The two numbers are
therefore not comparable.

The copy never renders "N of M". "none readable on this device" describes what
Dusori read, not an exhaustive claim about every source in the manifest, so the
cap can never surface as a wrong number.

A missing or invalid manifest reports `no sources yet`. Diagnosing a broken
manifest stays with workspace health, which already raises it in the **Needs
attention** lane.

## Scope

Routing is out of scope. The references-only case still opens Research; changing
its `ContinueLearningAction` would alter the action union, its routing in
`+page.svelte`, and the end-to-end expectations. The card states the gap; the
learner chooses.

Insights is out of scope. Adding a readable-source count to `TopicInsight` would
re-read every manifest `buildWorkspaceInsights` has already loaded, plus twelve
files per topic, and would force a decision about the read cap.

## Testing

Test-first in `packages/core/src/learning/today-focus.test.ts`:

- A topic with no sources reports `no sources yet`.
- A topic whose only source is a URL reference reports
  `1 source saved, none readable on this device`.
- Two URL references report `2 sources saved, none readable on this device`.
- A topic with pasted readable prose reports `local source ready`.
- Routing is unchanged in every case above.

No new Playwright journey. The rendered string is one interpolation over a value
the unit tests already pin.
