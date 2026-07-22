# Spaced review — design

**Status:** approved for planning · **Date:** 2026-07-21

## Goal

The review queue already tells a learner which topic to touch next, but it cannot say
when returning to a topic stops being useful — every unfinished topic sits in the
queue every day. Add **optional, explicit spaced scheduling** to the deterministic
review queue: after working a topic, the learner records how the review went; Dusori
computes the next due date from a fixed interval ladder, promotes due topics to the
top of the queue, and keeps not-yet-due topics out of it. A topic the learner never
marks reviewed behaves exactly as today. Dusori still creates no deadline on its own —
a schedule exists only after an explicit review action, which is what the product
spec's "optional generated review schedules" roadmap line means.

Primary scenario: a certification learner has four active topics. They work
"Configure Microsoft Entra ID", press **Got it**, and the topic leaves the queue
until its due date three days out. A weaker topic marked **Needs work** returns
tomorrow. The Today view now answers "what should I review right now" instead of
"what exists".

## Background — what exists and what was verified

- `buildReviewQueue` (`packages/core/src/learning/loop.ts:284`) is a pure function
  over `TodayTopicSummary[]`: active before paused, least recently updated first,
  complete excluded, limit 5. Its doc comment and the UI explainer both promise "no
  deadlines or schedule" — this design changes that promise to "no deadlines you did
  not create", and both strings change with it.
- Every learning-loop function takes an injected `now` (`buildWorkspaceRecap`
  options, `updateRoadmapObjective` parameter). Dated update files and the recap
  window use UTC calendar dates via `toISOString().slice(0, 10)`. Spaced review
  instead derives "what day is it" from the device's local time — the boundary
  that decides an interval is the learner's midnight, not UTC midnight.
- `packages/core/src/research/research-file.ts` is the proven template for per-topic
  machine state: file created on first use, absent file = feature inactive,
  `readMachineFile` quarantine on invalid content, three-attempt expected-hash retry
  write, topic existence guarded by reading `state.json` first.
- `packages/core/src/portable.ts` validates only the files it knows
  (`dusori.json`, `state.json`, `Sources/manifest.json`, required Markdown); other
  files ride through import/export untouched. Verified with `research.json`, which
  ships since v0.2.0 and is not in the validation list.
- Extending `TopicStateSchema` instead was considered and rejected: older app
  versions parse `state.json` with their own schema (`z.object` strips unknown
  keys) and `setTopicStatus` rewrites the file from the parsed object, so an old
  build would silently delete the review field. A new file is invisible to old
  builds — the same reasoning that produced `research.json`.
- `appendTopicUpdate` (`packages/core/src/conflict/write-protocol.ts:21`) gives
  dated, append-only update entries that already feed recent activity and the
  seven-day recap — review actions logged there appear in the recap for free.
- `apps/app/src/lib/components/LearningLoop.svelte` owns the Today view: storage
  arrives as a prop, actions call core directly, results surface through
  `success`/`error` strings and a reactive `refresh()`.

## Approaches considered

**A. Topic-level fixed interval ladder with an explicit two-outcome action
(recommended).** The queue's unit stays the topic. A review is recorded only by
pressing one of two buttons on a queue item; a fixed ladder maps repetition count to
the next interval. Smallest change that delivers spacing; zero behavior change for
anyone who never presses the buttons.

**B. Objective-level SM-2 flashcards.** Every completed roadmap objective becomes a
graded card with ease factors and a review session UI. Rejected here: that is the
"question generation from sources" program item — a different unit, a new session
surface, and an order of magnitude more state. Nothing in A blocks B later.

**C. Implicit scheduling from update activity.** Treat any update entry as a review
and schedule from it. Rejected: editing a note is not reviewing a topic, and Dusori's
ethos is explicit actions (explicit acceptance, explicit consent, explicit status).
Implicit signals would also make the queue non-explainable.

**Algorithm sub-choice: fixed ladder over SM-2.** SM-2's per-item ease factor needs a
4-5 grade answer scale and produces intervals no one can predict. A fixed ladder is
deterministic, explainable in one sentence, and matches a two-outcome input. Because
`dueOn` is stored (not recomputed), a future ladder change never moves an existing
promise. A per-topic ease factor is the documented upgrade path if the ladder ever
feels wrong.

Decision: **A**, with the ladder.

## Design

### Core module — `packages/core/src/learning/review.ts`

```ts
export const REVIEW_INTERVALS_DAYS = [1, 3, 7, 14, 30, 60] as const;

export type ReviewOutcome = 'good' | 'again';

export const ReviewScheduleSchema = z.object({
  schemaVersion: z.literal(schemaVersion), // stays 1
  topicSlug: z.string().min(1).max(80),
  repetition: z
    .number()
    .int()
    .min(0)
    .max(REVIEW_INTERVALS_DAYS.length - 1),
  lastReviewedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
});
export type ReviewSchedule = z.infer<typeof ReviewScheduleSchema>;

export function reviewFilePath(topicSlug: string): string; // Topics/<slug>/review.json
export function localDateOf(now: Date): string; // local getFullYear/Month/Date, not UTC
export function addDaysUtc(date: string, days: number): string; // pure Date.UTC math

/** Pure: next schedule from the current one (or none) and one outcome. */
export function nextReviewSchedule(
  current: ReviewSchedule | null,
  outcome: ReviewOutcome,
  topicSlug: string,
  now: Date,
): ReviewSchedule;

/** Null when the topic has never been reviewed; state.json guards topic existence. */
export function readReviewSchedule(
  storage: StorageAdapter,
  topicSlug: string,
  now?: Date,
): Promise<ReviewSchedule | null>;

/** Hash-guarded write with the three-attempt retry pattern, then an update entry. */
export function markTopicReviewed(
  storage: StorageAdapter,
  topicSlug: string,
  outcome: ReviewOutcome,
  now?: Date,
): Promise<ReviewSchedule>;
```

Ladder semantics: `good` advances `repetition` by one (first review starts at 0,
capped at the last rung); `again` resets it to 0. `dueOn = lastReviewedOn +
REVIEW_INTERVALS_DAYS[repetition]`. Both outcomes on a first review yield a one-day
interval — the ladder differentiates from the second review on.

On a write conflict, the retry loop re-reads the current schedule and reapplies the
outcome on top of it (recompute, not last-write-wins). `markTopicReviewed` appends
one update entry, so the recap and recent activity show reviews with no extra code:

- `good` → `- Reviewed this topic; the next review is <dueOn>.`
- `again` → `- Reviewed this topic for another pass on <dueOn>.`

### Data contract (additive; `schemaVersion` stays 1)

The first review action creates `Topics/<topic-slug>/review.json`:

```json
{
  "schemaVersion": 1,
  "topicSlug": "topic-slug",
  "repetition": 2,
  "lastReviewedOn": "2026-07-21",
  "dueOn": "2026-07-28"
}
```

Machine-owned, schema-validated, expected-hash guarded — exactly like
`research.json`. Older app builds never open the file; ZIP import and export carry
it through untouched; deleting it only forgets the schedule. The portable file
contract (README tree, `docs/adr/003-portable-file-contract.md`) gains a matching
appendix section.

### Queue ordering (`buildReviewQueue`, extended in place)

`buildTodaySummary` additionally reads each topic's schedule into
`TodayTopicSummary.review: ReviewSchedule | null`. `buildReviewQueue` gains an
optional third parameter `now: Date = new Date()` (the component keeps calling it
with defaults) and orders:

1. **Complete topics:** excluded (unchanged).
2. **Active, scheduled, due** (`dueOn <= today`): first, ordered by `dueOn`
   ascending (most overdue first), then `updatedAt`, `title`, `slug`.
3. **Active, never reviewed:** next, in today's order (`updatedAt`, `title`,
   `slug`) — the no-adoption path is byte-identical to current behavior.
4. **Active, scheduled, not yet due:** excluded from the queue; that is the
   feature's value.
5. **Paused:** last, ordered as today, unchanged and schedule-inert — pausing is
   explicit user intent and outranks any due date. A schedule on a paused topic is
   displayed but never reorders or excludes it.
6. `limit` (default 5) applies after ordering, unchanged.

`ReviewQueueItem` gains `dueOn: string | null`. Reason strings stay the explainable
one-liners the UI already renders: `Due today · spaced review`,
`Overdue since <dueOn> · spaced review`; unscheduled and paused reasons are
unchanged.

A new pure helper `nextScheduledReview(summaries, now): { dueOn, slug, title } |
null` returns the earliest not-yet-due active topic so the empty queue can say what
comes back when, without changing `buildReviewQueue`'s return type.

### App surface (`LearningLoop.svelte`, Today view only)

- Each queue item gains two buttons beside the existing open-roadmap arrow:
  **Got it** (`good`) and **Needs work** (`again`), with aria-labels naming the
  topic, 44 px targets, disabled while a review write is in flight. Reviewing from
  the queue is a judgment call the learner makes — the objective and progress are
  on the card, and the roadmap is one click away.
- Success surfaces through the component's existing status line:
  `Reviewed “<title>”. The next review is <date>.` /
  `Reviewed “<title>”. It returns tomorrow.` Errors render adjacent to the queue
  with the exact alternative, per `design.md`.
- The explainer sentence changes from "Active topics come first, least recently
  updated first. Dusori creates no deadlines." to "Due reviews come first, then
  active topics least recently updated first. Deadlines exist only for topics you
  mark reviewed."
- Empty queue with scheduled topics: `No reviews due. “<title>” returns on <date>.`
  (from `nextScheduledReview`). With nothing scheduled, the current empty copy
  stays.
- A due item carries its date in the reason line it already renders (`Due today` or
  `Overdue since <date>`); a paused topic that holds a schedule appends
  `· scheduled for <date>` there instead (a paused topic never leaves the queue, so
  nothing is "returning"), so no new date element is introduced.
- No other surface changes: topic ledger, roadmap view, recap layout, and graph are
  untouched (review actions appear in the recap through normal update entries).

### Docs to update in the implementing PR (not before)

`docs/product/spec.md` (move schedules/due dates/spaced intervals out of
"Explicitly not built yet", leaving closed-app/unattended work there; describe the
explicit-action model), site `roadmap.md` (Planned → Shipped wording), README
product table + roadmap sentence + portable contract tree, ADR-003 appendix,
CHANGELOG entry. Version bump and release notes are **out of this feature's scope**
— the unmerged v0.5.0 research-agent branch decides the next version number at
merge time.

## Security and trust

No network egress, no new permissions, no identifiers, no background execution: the
whole feature is local reads, one machine-owned JSON file, and update-log lines.
Schedules exist only after an explicit in-app action, are visible as plain JSON in
the workspace, and deleting `review.json` cleanly forgets them. The service worker,
companion, and consent surfaces are untouched.

## Testing

Unit (vitest, `MemoryStorageAdapter`, injected dates, no network):

- Ladder math: first review (both outcomes) → 1 day; `good` progression through
  every rung including the 60-day cap; `again` reset from a high rung; `dueOn`
  arithmetic across month/year boundaries via `addDaysUtc`.
- `markTopicReviewed` round-trip: file created on first review with expected
  content; second review updates under hash guard; a concurrent external write
  triggers the retry path and still lands the outcome; update entry text lands in
  the dated log; missing topic fails with the existing machine-file error.
- Invalid `review.json` is quarantined by `readMachineFile` (`.invalid-<timestamp>`)
  and surfaces as never-reviewed afterward.
- Queue ordering: mixed workspace (due-overdue, due-today, never-reviewed, future-
  due, paused-with-schedule, complete) asserts the exact order, exclusions, reason
  strings, `dueOn` passthrough, and that a workspace with no `review.json` files
  keeps today's exact ordering and content apart from the new `dueOn: null` field.
- `nextScheduledReview` picks the earliest future due date and returns null with
  nothing scheduled.

E2E (Playwright, built app, no network):

- Mark a queue topic **Got it** → success line, topic leaves the queue, recap shows
  the review entry, reload keeps it gone, and `review.json` holds the expected
  schedule (persistence).
- Empty-queue message names the next due topic and date.
- The **Needs work** outcome is covered at the unit level (schedule reset plus its
  own update-log line): a one-day interval also removes the topic from the queue, so
  an e2e pass over it would assert the same emptied-queue state as **Got it**.
- Existing axe checks stay green with the new buttons in the accessibility tree.

## Out of scope

- Question generation from sources (next program item; pairs with, but does not
  block, this feature).
- Per-objective or per-source scheduling, ease factors, review history/statistics
  views, calendar exports, notifications, and any closed-app or background work.
- Reminding or nagging: an overdue topic is a queue position, never an alert.
- Version bump / release prep (merge-order dependent, see Docs section).

## Risks

| Risk                                                       | Mitigation                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Old builds encountering `review.json`                      | They never read unknown files; import validation ignores it (verified `research.json` precedent). No schema widening of existing files is involved.                                                                                                                                                                                                                  |
| UTC dates vs the learner's local day                       | The calendar day (`lastReviewedOn`, `dueOn`, and the queue's due comparison) comes from the device's local time, not UTC — a review at any local hour lands on the local day the learner saw. The residual is the ordinary ±1-day granularity of any date-only scheduler (a review right at local midnight can round to either neighboring day), not a timezone bug. |
| Fixed ladder fits some topics poorly                       | Stored `dueOn` keeps every existing promise if the ladder changes; per-topic ease factor is the named upgrade path.                                                                                                                                                                                                                                                  |
| Future-due topics vanishing from the queue surprises users | New explainer sentence, empty-state naming the next return date, and the topic ledger still lists every topic.                                                                                                                                                                                                                                                       |
| Concurrent review writes (second tab, external sync)       | Same three-attempt expected-hash retry as `research.json`, recomputing from the fresh schedule so the outcome is never silently dropped.                                                                                                                                                                                                                             |
| Copy drift ("no deadlines" promise appears in docs and UI) | The implementing PR updates the doc comment, UI explainer, product spec, roadmap page, and README in one change; e2e asserts the new explainer.                                                                                                                                                                                                                      |
