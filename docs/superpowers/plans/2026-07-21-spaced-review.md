# Spaced Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional, explicit spaced-review scheduling to the deterministic review queue per the approved spec `docs/superpowers/specs/2026-07-21-spaced-review-design.md`: a "Got it" / "Needs work" action on a Today queue item stores a fixed-ladder schedule in a new machine-owned `Topics/<slug>/review.json`, due topics rise to the top of the queue, scheduled topics rest until due, and topics never marked reviewed behave exactly as today.

**Architecture:** `@dusori/core` gains `learning/review.ts` (interval ladder, zod schema, pure schedule math, hash-guarded persistence modeled on `research/research-file.ts`) and a due-aware `buildReviewQueue` plus a `nextScheduledReview` helper in `learning/loop.ts`. The SvelteKit Today view (`LearningLoop.svelte`) gains two review buttons per queue item and a schedule-aware empty state. No network, no new dependencies, no schema-version bump.

**Tech Stack:** TypeScript, zod (`z.literal`, `z.string().regex`), vitest with `MemoryStorageAdapter`, Playwright e2e against the built Pages artifact, Svelte 5 with legacy props (`export let`) and lowercase event attributes (`onclick=`), pnpm 11 / Node 24.

## Global Constraints

- `schemaVersion` stays `1`. Never bump it. Never widen or extend `TopicStateSchema`, `WorkspaceSchema`, or `SourceManifestSchema` — review state lives ONLY in the new `review.json`.
- No new dependencies anywhere (app, core, companion, e2e).
- All dates in stored files are UTC calendar dates `YYYY-MM-DD` derived via `toISOString().slice(0, 10)`; every function that touches time takes an injected `now: Date` (defaulted), never `Date.now()`.
- The interval ladder is exactly `[1, 3, 7, 14, 30, 60]` days. `good` advances one rung (capped at 60), `again` resets to rung 0, a first review starts at rung 0 for both outcomes.
- Machine files are written as `` `${JSON.stringify(value, null, 2)}\n` `` with `expectedHash` guards and the three-attempt `StorageConflictError` retry pattern from `packages/core/src/research/research-file.ts`.
- Error copy is a complete sentence naming the exact next step, matching existing tone (e.g. "The review schedule changed repeatedly. Try marking this review again.").
- Exact UI copy (curly quotes included) is given in Task 4 — do not paraphrase it; e2e (Task 5) and the queue explainer must match character-for-character.
- All commands run from the repo root. One file: `pnpm vitest run <path>`. Unit suite: `pnpm test:unit`. Full gate: `pnpm check`, then `pnpm test:e2e`.
- ⚠️ Worktree trap: when executing inside a `.claude/worktrees/*` checkout, eslint silently skips files. After `pnpm check` passes, additionally run `pnpm exec eslint --no-ignore <each changed .ts/.svelte file>` and fix anything it reports.
- Commit after every task with the message given in its final step.

---

### Task 1: Pure spaced-review schedule module

**Files:**

- Create: `packages/core/src/learning/review.ts`
- Create: `packages/core/src/learning/review.test.ts`
- Modify: `packages/core/src/index.ts` (one export line)

**Interfaces:**

- Consumes: `schemaVersion` from `../schemas/workspace.js` (the `1` literal).
- Produces (used by Tasks 2–4): `REVIEW_INTERVALS_DAYS: readonly number[]`, `type ReviewOutcome = 'good' | 'again'`, `ReviewScheduleSchema` (zod), `type ReviewSchedule = { schemaVersion: 1; topicSlug: string; repetition: number; lastReviewedOn: string; dueOn: string }`, `reviewFilePath(topicSlug: string): string`, `utcDateOf(now: Date): string`, `addDaysUtc(date: string, days: number): string`, `nextReviewSchedule(current: ReviewSchedule | null, outcome: ReviewOutcome, topicSlug: string, now: Date): ReviewSchedule`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/learning/review.test.ts
import { describe, expect, it } from 'vitest';

import {
  addDaysUtc,
  nextReviewSchedule,
  utcDateOf,
  type ReviewSchedule,
} from './review.js';

const on = new Date('2026-07-21T12:00:00.000Z');

describe('spaced review schedule math', () => {
  it('starts every first review one day out, for both outcomes', () => {
    for (const outcome of ['good', 'again'] as const) {
      expect(nextReviewSchedule(null, outcome, 'ai-fundamentals', on)).toEqual({
        schemaVersion: 1,
        topicSlug: 'ai-fundamentals',
        repetition: 0,
        lastReviewedOn: '2026-07-21',
        dueOn: '2026-07-22',
      });
    }
  });

  it('advances good reviews up the ladder and caps at sixty days', () => {
    const expected = [
      { repetition: 0, dueOn: '2026-07-22' },
      { repetition: 1, dueOn: '2026-07-24' },
      { repetition: 2, dueOn: '2026-07-28' },
      { repetition: 3, dueOn: '2026-08-04' },
      { repetition: 4, dueOn: '2026-08-20' },
      { repetition: 5, dueOn: '2026-09-19' },
      { repetition: 5, dueOn: '2026-09-19' },
    ];
    let schedule: ReviewSchedule | null = null;
    for (const step of expected) {
      schedule = nextReviewSchedule(schedule, 'good', 'ai-fundamentals', on);
      expect(schedule).toMatchObject(step);
    }
  });

  it('resets to the first rung on needs-work', () => {
    const current: ReviewSchedule = {
      schemaVersion: 1,
      topicSlug: 'ai-fundamentals',
      repetition: 4,
      lastReviewedOn: '2026-07-01',
      dueOn: '2026-07-31',
    };
    expect(nextReviewSchedule(current, 'again', 'ai-fundamentals', on)).toMatchObject({
      repetition: 0,
      lastReviewedOn: '2026-07-21',
      dueOn: '2026-07-22',
    });
  });

  it('crosses month and year boundaries in UTC', () => {
    expect(addDaysUtc('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysUtc('2026-01-30', 3)).toBe('2026-02-02');
    expect(addDaysUtc('2028-02-28', 1)).toBe('2028-02-29');
    expect(utcDateOf(new Date('2026-07-21T23:59:59.000Z'))).toBe('2026-07-21');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/learning/review.test.ts`
Expected: FAIL — cannot resolve `./review.js`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/learning/review.ts
import { z } from 'zod';

import { schemaVersion } from '../schemas/workspace.js';
import { topicRoot } from '../workspace/paths.js';

// ponytail: fixed Leitner-style ladder, two outcomes. A per-topic ease factor
// is the upgrade path if these rungs ever fit real topics poorly; stored dueOn
// values keep every promise already made if the ladder changes.
export const REVIEW_INTERVALS_DAYS = [1, 3, 7, 14, 30, 60] as const;

export type ReviewOutcome = 'good' | 'again';

const utcDate = /^\d{4}-\d{2}-\d{2}$/u;

export const ReviewScheduleSchema = z.object({
  schemaVersion: z.literal(schemaVersion),
  topicSlug: z.string().min(1).max(80),
  repetition: z
    .number()
    .int()
    .min(0)
    .max(REVIEW_INTERVALS_DAYS.length - 1),
  lastReviewedOn: z.string().regex(utcDate),
  dueOn: z.string().regex(utcDate),
});

export type ReviewSchedule = z.infer<typeof ReviewScheduleSchema>;

export function reviewFilePath(topicSlug: string): string {
  return `${topicRoot(topicSlug)}/review.json`;
}

export function utcDateOf(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function addDaysUtc(date: string, days: number): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Pure: the schedule after recording one outcome on top of the current one. */
export function nextReviewSchedule(
  current: ReviewSchedule | null,
  outcome: ReviewOutcome,
  topicSlug: string,
  now: Date,
): ReviewSchedule {
  const repetition =
    outcome === 'again' || current === null
      ? 0
      : Math.min(current.repetition + 1, REVIEW_INTERVALS_DAYS.length - 1);
  const lastReviewedOn = utcDateOf(now);
  return ReviewScheduleSchema.parse({
    schemaVersion,
    topicSlug,
    repetition,
    lastReviewedOn,
    dueOn: addDaysUtc(lastReviewedOn, REVIEW_INTERVALS_DAYS[repetition] ?? 1),
  });
}
```

- [ ] **Step 4: Export the module from core's index**

In `packages/core/src/index.ts`, directly after the line `export * from './learning/loop.js';`, add:

```ts
export * from './learning/review.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/learning/review.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/learning/review.ts packages/core/src/learning/review.test.ts packages/core/src/index.ts
git commit -m "feat(core): add the spaced review interval ladder"
```

---

### Task 2: Persist explicit reviews in review.json

**Files:**

- Modify: `packages/core/src/learning/review.ts` (append two functions and imports)
- Modify: `packages/core/src/learning/review.test.ts` (append a describe block)

**Interfaces:**

- Consumes: Task 1's `ReviewScheduleSchema`, `nextReviewSchedule`, `reviewFilePath`; `readMachineFile` from `../schemas/read-machine-file.js`; `appendTopicUpdate` from `../conflict/write-protocol.js`; `StorageConflictError`, `StorageAdapter` from `../adapters.js`; `TopicStateSchema` from `../schemas/workspace.js`.
- Produces (used by Tasks 3–4): `readReviewSchedule(storage: StorageAdapter, topicSlug: string, now?: Date): Promise<ReviewSchedule | null>` and `markTopicReviewed(storage: StorageAdapter, topicSlug: string, outcome: ReviewOutcome, now?: Date): Promise<ReviewSchedule>`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/learning/review.test.ts` (extend the existing import from `./review.js` with `markTopicReviewed` and `readReviewSchedule`, and add the new imports below it):

```ts
import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace } from '../workspace/create.js';

describe('spaced review persistence', () => {
  const created = new Date('2026-07-20T12:00:00.000Z');

  it('creates review.json on the first review and logs the outcome', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', created);
    const topic = await createTopic(storage, 'AI Fundamentals', created);

    const schedule = await markTopicReviewed(
      storage,
      topic.topicSlug,
      'good',
      new Date('2026-07-20T13:00:00.000Z'),
    );

    expect(schedule).toEqual({
      schemaVersion: 1,
      topicSlug: topic.topicSlug,
      repetition: 0,
      lastReviewedOn: '2026-07-20',
      dueOn: '2026-07-21',
    });
    const file = await storage.read(`Topics/${topic.topicSlug}/review.json`);
    expect(JSON.parse(file?.content ?? '{}')).toEqual(schedule);
    expect((await storage.read(topic.updatePath))?.content).toContain(
      '- Reviewed this topic; the next review is 2026-07-21.',
    );
    expect(await readReviewSchedule(storage, topic.topicSlug)).toEqual(schedule);
  });

  it('records a needs-work pass with its own update entry', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', created);
    const topic = await createTopic(storage, 'AI Fundamentals', created);
    await markTopicReviewed(storage, topic.topicSlug, 'good', new Date('2026-07-20T13:00:00.000Z'));

    const schedule = await markTopicReviewed(
      storage,
      topic.topicSlug,
      'again',
      new Date('2026-07-21T09:00:00.000Z'),
    );

    expect(schedule).toMatchObject({ repetition: 0, dueOn: '2026-07-22' });
    const log = await storage.read(`Topics/${topic.topicSlug}/Updates/2026/07/2026-07-21.md`);
    expect(log?.content).toContain('- Reviewed this topic for another pass on 2026-07-22.');
  });

  it('recomputes on top of an externally rewritten schedule instead of clobbering it', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', created);
    const topic = await createTopic(storage, 'AI Fundamentals', created);
    await markTopicReviewed(storage, topic.topicSlug, 'good', new Date('2026-07-20T13:00:00.000Z'));
    const external = {
      schemaVersion: 1,
      topicSlug: topic.topicSlug,
      repetition: 3,
      lastReviewedOn: '2026-07-18',
      dueOn: '2026-08-01',
    };
    await storage.externalWrite(
      `Topics/${topic.topicSlug}/review.json`,
      `${JSON.stringify(external, null, 2)}\n`,
    );

    const schedule = await markTopicReviewed(
      storage,
      topic.topicSlug,
      'good',
      new Date('2026-07-22T09:00:00.000Z'),
    );

    expect(schedule).toMatchObject({ repetition: 4, dueOn: '2026-08-21' });
  });

  it('quarantines an invalid review file and starts fresh afterward', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', created);
    const topic = await createTopic(storage, 'AI Fundamentals', created);
    await storage.externalWrite(`Topics/${topic.topicSlug}/review.json`, 'not json');

    await expect(
      markTopicReviewed(storage, topic.topicSlug, 'good', new Date('2026-07-20T13:00:00.000Z')),
    ).rejects.toThrow(/quarantined/u);
    expect(await readReviewSchedule(storage, topic.topicSlug)).toBeNull();
    await expect(
      markTopicReviewed(storage, topic.topicSlug, 'good', new Date('2026-07-20T14:00:00.000Z')),
    ).resolves.toMatchObject({ repetition: 0 });
  });

  it('returns null for a never-reviewed topic and fails for a missing topic', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', created);
    const topic = await createTopic(storage, 'AI Fundamentals', created);

    expect(await readReviewSchedule(storage, topic.topicSlug)).toBeNull();
    await expect(readReviewSchedule(storage, 'missing-topic')).rejects.toThrow(
      /Required machine file is missing/u,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm vitest run packages/core/src/learning/review.test.ts`
Expected: FAIL — `markTopicReviewed` / `readReviewSchedule` are not exported. The four Task 1 tests still pass.

- [ ] **Step 3: Write the implementation**

In `packages/core/src/learning/review.ts`, extend the imports at the top of the file to:

```ts
import { z } from 'zod';

import { StorageConflictError, type StorageAdapter } from '../adapters.js';
import { appendTopicUpdate } from '../conflict/write-protocol.js';
import { readMachineFile } from '../schemas/read-machine-file.js';
import { TopicStateSchema, schemaVersion } from '../schemas/workspace.js';
import { topicRoot } from '../workspace/paths.js';
```

Append at the end of the file:

```ts
/** Null when the topic has never been reviewed; state.json guards topic existence. */
export async function readReviewSchedule(
  storage: StorageAdapter,
  topicSlug: string,
  now = new Date(),
): Promise<ReviewSchedule | null> {
  const root = topicRoot(topicSlug);
  await readMachineFile(storage, `${root}/state.json`, TopicStateSchema, now);
  const path = reviewFilePath(topicSlug);
  if (!(await storage.read(path))) return null;
  return readMachineFile(storage, path, ReviewScheduleSchema, now);
}

/** Records one explicit review outcome: hash-guarded write plus a dated update entry. */
export async function markTopicReviewed(
  storage: StorageAdapter,
  topicSlug: string,
  outcome: ReviewOutcome,
  now = new Date(),
): Promise<ReviewSchedule> {
  const normalizedSlug = topicRoot(topicSlug).slice('Topics/'.length);
  const path = reviewFilePath(topicSlug);
  await readMachineFile(storage, `${topicRoot(topicSlug)}/state.json`, TopicStateSchema, now);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const snapshot = await storage.read(path);
    const current = snapshot
      ? await readMachineFile(storage, path, ReviewScheduleSchema, now)
      : null;
    const next = nextReviewSchedule(current, outcome, normalizedSlug, now);
    try {
      await storage.write(path, `${JSON.stringify(next, null, 2)}\n`, {
        expectedHash: snapshot?.hash ?? null,
      });
    } catch (error) {
      if (!(error instanceof StorageConflictError)) throw error;
      continue;
    }

    // The review.json write is definitively committed at this point, so a
    // log-append conflict below must propagate as its own error rather than
    // re-triggering the schedule recompute above (that would double-apply
    // the outcome against the write we already made).
    await appendTopicUpdate(
      storage,
      topicSlug,
      outcome === 'good'
        ? `- Reviewed this topic; the next review is ${next.dueOn}.`
        : `- Reviewed this topic for another pass on ${next.dueOn}.`,
      now,
    );
    return next;
  }

  throw new Error('The review schedule changed repeatedly. Try marking this review again.');
}
```

> **Corrected during execution.** An earlier draft of this block wrapped
> `appendTopicUpdate` inside the same `try` and rethrew on `attempt === 2`.
> Both were defects: a log-append conflict re-entered the retry loop after the
> schedule write had already committed (double-advancing the ladder), and the
> `attempt === 2` rethrow made the "changed repeatedly" message unreachable, so
> a genuine triple conflict leaked a raw `StorageConflictError`. Commits
> `731d200` and `bcd67a4` fixed both, with tests forcing real conflicts.
> `packages/core/src/research/research-file.ts` still carries the second
> pattern; it is tracked separately, out of this branch's scope.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/src/learning/review.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/learning/review.ts packages/core/src/learning/review.test.ts
git commit -m "feat(core): persist explicit topic reviews in review.json"
```

---

### Task 3: Due-aware review queue and next-scheduled helper

**Files:**

- Modify: `packages/core/src/learning/loop.ts`
- Modify: `packages/core/src/learning/loop.test.ts` (append a describe block)

**Interfaces:**

- Consumes: Task 2's `readReviewSchedule`, Task 1's `utcDateOf` and `type ReviewSchedule`, both from `./review.js`.
- Produces (used by Task 4): `TodayTopicSummary` gains `review: ReviewSchedule | null`; `ReviewQueueItem` gains `dueOn: string | null`; `buildReviewQueue(summaries, limit = 5, now = new Date())`; `nextScheduledReview(summaries: TodayTopicSummary[], now?: Date): NextScheduledReview | null` with `interface NextScheduledReview { dueOn: string; slug: string; title: string }`. Reason strings: `'Due today · spaced review'`, `` `Overdue since ${dueOn} · spaced review` ``; the existing `'Active · least recently updated first'` and `'Paused · resume when ready'` are unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/learning/loop.test.ts` — extend the existing `./loop.js` import list with `nextScheduledReview`, and add `import { markTopicReviewed } from './review.js';` below the other relative imports:

```ts
describe('spaced review queue', () => {
  it('promotes due reviews, keeps unscheduled order, and hides future-due topics', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    const overdue = await createTopic(storage, 'Overdue topic', new Date('2026-07-10T12:00:00.000Z'));
    const dueToday = await createTopic(
      storage,
      'Due today topic',
      new Date('2026-07-11T12:00:00.000Z'),
    );
    await createTopic(storage, 'Never reviewed', new Date('2026-07-12T12:00:00.000Z'));
    const scheduled = await createTopic(
      storage,
      'Scheduled out',
      new Date('2026-07-13T12:00:00.000Z'),
    );
    const workspace = scheduled.workspace;
    await markTopicReviewed(storage, overdue.topicSlug, 'good', new Date('2026-07-15T12:00:00.000Z'));
    await markTopicReviewed(
      storage,
      dueToday.topicSlug,
      'good',
      new Date('2026-07-19T12:00:00.000Z'),
    );
    await markTopicReviewed(storage, scheduled.topicSlug, 'good', new Date('2026-07-18T12:00:00.000Z'));
    await markTopicReviewed(storage, scheduled.topicSlug, 'good', new Date('2026-07-19T12:00:00.000Z'));

    const summaries = await buildTodaySummary(storage, workspace);
    const asOf = new Date('2026-07-20T12:00:00.000Z');
    const queue = buildReviewQueue(summaries, 5, asOf);

    expect(queue.map((item) => item.title)).toEqual([
      'Overdue topic',
      'Due today topic',
      'Never reviewed',
    ]);
    expect(queue[0]).toMatchObject({
      dueOn: '2026-07-16',
      reason: 'Overdue since 2026-07-16 · spaced review',
    });
    expect(queue[1]).toMatchObject({ dueOn: '2026-07-20', reason: 'Due today · spaced review' });
    expect(queue[2]).toMatchObject({
      dueOn: null,
      reason: 'Active · least recently updated first',
    });
    expect(nextScheduledReview(summaries, asOf)).toEqual({
      dueOn: '2026-07-22',
      slug: scheduled.topicSlug,
      title: 'Scheduled out',
    });
  });

  it('keeps paused topics in their place regardless of schedule', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    await createTopic(storage, 'Active fresh', new Date('2026-07-18T12:00:00.000Z'));
    const paused = await createTopic(
      storage,
      'Paused scheduled',
      new Date('2026-07-17T12:00:00.000Z'),
    );
    await markTopicReviewed(storage, paused.topicSlug, 'good', new Date('2026-07-18T12:00:00.000Z'));
    await markTopicReviewed(storage, paused.topicSlug, 'good', new Date('2026-07-19T12:00:00.000Z'));
    await setTopicStatus(storage, paused.topicSlug, 'paused', new Date('2026-07-19T13:00:00.000Z'));

    const summaries = await buildTodaySummary(storage, paused.workspace);
    const asOf = new Date('2026-07-20T12:00:00.000Z');
    const queue = buildReviewQueue(summaries, 5, asOf);

    expect(queue.map((item) => item.title)).toEqual(['Active fresh', 'Paused scheduled']);
    expect(queue[1]).toMatchObject({ dueOn: '2026-07-22', reason: 'Paused · resume when ready' });
    expect(nextScheduledReview(summaries, asOf)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm vitest run packages/core/src/learning/loop.test.ts`
Expected: FAIL — `nextScheduledReview` is not exported (and `review`/`dueOn` fields are missing). The five existing tests still pass.

- [ ] **Step 3: Write the implementation**

In `packages/core/src/learning/loop.ts`:

1. Below the existing relative imports, add:

```ts
import { readReviewSchedule, utcDateOf, type ReviewSchedule } from './review.js';
```

2. In `interface TodayTopicSummary`, add one field after `recentActivity`:

```ts
  review: ReviewSchedule | null;
```

3. In `interface ReviewQueueItem`, add one field before `objective`:

```ts
  dueOn: string | null;
```

4. Add after the `WorkspaceRecapOptions` interface:

```ts
export interface NextScheduledReview {
  dueOn: string;
  slug: string;
  title: string;
}
```

5. In `buildTodaySummary`, replace the destructured `Promise.all` and returned object:

```ts
      const [state, progress, recentActivity, review] = await Promise.all([
        readMachineFile(storage, `${root}/state.json`, TopicStateSchema),
        readTopicProgress(storage, topic.slug),
        readRecentTopicActivity(storage, topic.slug),
        readReviewSchedule(storage, topic.slug),
      ]);
      return {
        progress,
        recentActivity,
        review,
        slug: topic.slug,
        status: state.status,
        title: topic.title,
        updatedAt: state.updatedAt,
      };
```

6. Replace the whole `buildReviewQueue` function (including its doc comment) with:

```ts
/** Orders unfinished topics from explicit local state; deadlines exist only where the learner recorded a review. */
export function buildReviewQueue(
  summaries: TodayTopicSummary[],
  limit = 5,
  now = new Date(),
): ReviewQueueItem[] {
  const today = utcDateOf(now);
  const statusPriority: Record<TopicState['status'], number> = {
    active: 0,
    paused: 1,
    complete: 2,
  };
  const dueGroup = (summary: TodayTopicSummary): number => {
    if (summary.status !== 'active' || summary.review === null) return 1;
    return summary.review.dueOn <= today ? 0 : 2;
  };
  return summaries
    .filter((summary) => summary.status !== 'complete' && dueGroup(summary) !== 2)
    .sort(
      (left, right) =>
        statusPriority[left.status] - statusPriority[right.status] ||
        dueGroup(left) - dueGroup(right) ||
        (left.review !== null &&
        right.review !== null &&
        dueGroup(left) === 0 &&
        dueGroup(right) === 0
          ? left.review.dueOn.localeCompare(right.review.dueOn)
          : 0) ||
        left.updatedAt.localeCompare(right.updatedAt) ||
        left.title.localeCompare(right.title) ||
        left.slug.localeCompare(right.slug),
    )
    .slice(0, Math.max(0, limit))
    .map((summary) => ({
      dueOn: summary.review?.dueOn ?? null,
      objective:
        summary.progress.nextObjective?.title ??
        (summary.progress.total
          ? 'Review the finished roadmap and decide whether to complete this topic.'
          : 'Add the first reviewable objective to this roadmap.'),
      progressPercent: summary.progress.percent,
      reason:
        summary.status === 'paused'
          ? 'Paused · resume when ready'
          : summary.review !== null && summary.review.dueOn <= today
            ? summary.review.dueOn === today
              ? 'Due today · spaced review'
              : `Overdue since ${summary.review.dueOn} · spaced review`
            : 'Active · least recently updated first',
      slug: summary.slug,
      status: summary.status,
      title: summary.title,
      updatedAt: summary.updatedAt,
    }));
}

/** The earliest not-yet-due active topic, so an empty queue can say what returns when. */
export function nextScheduledReview(
  summaries: TodayTopicSummary[],
  now = new Date(),
): NextScheduledReview | null {
  const today = utcDateOf(now);
  const upcoming = summaries
    .filter(
      (summary): summary is TodayTopicSummary & { review: ReviewSchedule } =>
        summary.status === 'active' && summary.review !== null && summary.review.dueOn > today,
    )
    .sort(
      (left, right) =>
        left.review.dueOn.localeCompare(right.review.dueOn) ||
        left.title.localeCompare(right.title) ||
        left.slug.localeCompare(right.slug),
    );
  const first = upcoming[0];
  return first ? { dueOn: first.review.dueOn, slug: first.slug, title: first.title } : null;
}
```

- [ ] **Step 4: Run the core unit suite**

Run: `pnpm vitest run packages/core/src/learning/loop.test.ts packages/core/src/learning/review.test.ts`
Expected: PASS (16 tests) — the five pre-existing loop tests must pass unchanged; if one fails, the queue changed for unscheduled workspaces, which is a regression to fix before continuing.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/learning/loop.ts packages/core/src/learning/loop.test.ts
git commit -m "feat(core): order the review queue by spaced due dates"
```

---

### Task 4: Review actions on the Today queue

**Files:**

- Modify: `apps/app/src/lib/components/LearningLoop.svelte`
- Modify: `apps/app/src/lib/components/LearningLoop.preview.html:2` (one comment line)

**Interfaces:**

- Consumes: `markTopicReviewed`, `nextScheduledReview`, `type NextScheduledReview`, `type ReviewOutcome` from `@dusori/core` (Tasks 2–3); the component's existing `storage` prop, `success`/`error` feedback region (shared, `aria-live="polite"`), `refresh()`, and `activityDate()`.
- Produces: the exact button and message copy that Task 5's e2e asserts.

- [ ] **Step 1: Extend the core import and component state**

In the `@dusori/core` import block, add `markTopicReviewed,` and `nextScheduledReview,` in alphabetical order among the value imports, and `type NextScheduledReview,` and `type ReviewOutcome,` in alphabetical order among the type imports.

After the line `let reviewQueue: ReviewQueueItem[] = [];` add:

```ts
  let nextReview: NextScheduledReview | null = null;
```

After the line `let workingIndex: number | null = null;` add:

```ts
  let reviewWorkingSlug: string | null = null;
```

- [ ] **Step 2: Compute the next scheduled review during refresh**

In `refresh()`, replace:

```ts
      summaries = nextSummaries;
      reviewQueue = buildReviewQueue(nextSummaries);
      recap = nextRecap;
```

with:

```ts
      summaries = nextSummaries;
      reviewQueue = buildReviewQueue(nextSummaries);
      nextReview = nextScheduledReview(nextSummaries);
      recap = nextRecap;
```

- [ ] **Step 3: Add the review handler**

Directly before `function activityDate(value: string): string {`, add:

```ts
  async function markReviewed(item: ReviewQueueItem, outcome: ReviewOutcome): Promise<void> {
    reviewWorkingSlug = item.slug;
    error = '';
    success = '';
    try {
      const schedule = await markTopicReviewed(storage, item.slug, outcome);
      success =
        outcome === 'good'
          ? `Reviewed “${item.title}”. The next review is ${activityDate(schedule.dueOn)}.`
          : `Reviewed “${item.title}”. It returns tomorrow.`;
      await refresh();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Dusori could not record this review.';
    } finally {
      reviewWorkingSlug = null;
    }
  }
```

- [ ] **Step 4: Update the queue markup**

Replace the explainer paragraph:

```svelte
          <p class="focus-explainer">
            Active topics come first, least recently updated first. Dusori creates no deadlines.
          </p>
```

with:

```svelte
          <p class="focus-explainer">
            Due reviews come first, then active topics least recently updated first. Deadlines
            exist only for topics you mark reviewed.
          </p>
```

Replace the empty state:

```svelte
          {#if reviewQueue.length === 0}
            <p class="focus-empty">No unfinished active or paused topics.</p>
          {:else}
```

with:

```svelte
          {#if reviewQueue.length === 0}
            {#if nextReview}
              <p class="focus-empty">
                No reviews due. “{nextReview.title}” returns on {activityDate(nextReview.dueOn)}.
              </p>
            {:else}
              <p class="focus-empty">No unfinished active or paused topics.</p>
            {/if}
          {:else}
```

Replace the queue item body (the whole `<li>` content inside the `{#each reviewQueue …}` block):

```svelte
                <li>
                  <span class="queue-rank">{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.objective}</p>
                    <small
                      >{item.reason} · {item.progressPercent}% complete{item.status === 'paused' &&
                      item.dueOn
                        ? ` · returns ${activityDate(item.dueOn)}`
                        : ''}</small
                    >
                  </div>
                  <div class="queue-actions">
                    <button
                      class="queue-review"
                      aria-label={`Got it — mark ${item.title} reviewed`}
                      disabled={reviewWorkingSlug !== null}
                      onclick={() => markReviewed(item, 'good')}
                    >
                      Got it
                    </button>
                    <button
                      class="queue-review"
                      aria-label={`Needs work — review ${item.title} again tomorrow`}
                      disabled={reviewWorkingSlug !== null}
                      onclick={() => markReviewed(item, 'again')}
                    >
                      Needs work
                    </button>
                    <button
                      aria-label={`Open ${item.title} roadmap`}
                      onclick={() => onOpenRoadmap(item.slug)}
                    >
                      <ArrowRight aria-hidden="true" size={16} />
                    </button>
                  </div>
                </li>
```

- [ ] **Step 5: Style the action group**

Replace the `.review-queue li button` rule:

```css
  .review-queue li button {
    display: grid;
    width: 2.75rem;
    padding: 0;
    background: var(--color-paper);
    color: var(--color-accent-text);
    place-items: center;
  }
```

with:

```css
  .review-queue li button {
    display: grid;
    min-height: 2.75rem;
    width: 2.75rem;
    padding: 0;
    background: var(--color-paper);
    color: var(--color-accent-text);
    place-items: center;
  }

  .queue-actions {
    display: grid;
    gap: var(--space-2xs);
    justify-items: stretch;
  }

  .queue-actions .queue-review {
    width: auto;
    padding-inline: var(--space-sm);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
```

- [ ] **Step 6: Update the preview contract comment**

In `apps/app/src/lib/components/LearningLoop.preview.html` line 2, change `deterministic review order` to `deterministic review order with optional spaced review` (the comment only; no markup changes).

- [ ] **Step 7: Verify the workspace gate**

Run: `pnpm check`
Expected: PASS (lint, types, unit, build). Then, because worktree eslint skips silently:
Run: `pnpm exec eslint --no-ignore apps/app/src/lib/components/LearningLoop.svelte packages/core/src/learning/review.ts packages/core/src/learning/loop.ts`
Expected: no output (clean).

- [ ] **Step 8: Commit**

```bash
git add apps/app/src/lib/components/LearningLoop.svelte apps/app/src/lib/components/LearningLoop.preview.html
git commit -m "feat(app): record spaced reviews from the Today queue"
```

---

### Task 5: End-to-end spaced review flow

**Files:**

- Modify: `tests/e2e/dusori.spec.ts` (append one test after the `learning loop protects an externally edited roadmap before accepting progress` test)

**Interfaces:**

- Consumes: existing helpers `createBrowserWorkspace(page)`, `createTopic(page)` (creates the active topic "AI Fundamentals"), `expectNoSeriousA11yViolations(page)`; the copy produced in Task 4.
- Produces: nothing further.

- [ ] **Step 1: Write the failing test**

```ts
test('spaced review schedules a topic and explains the resting queue', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page);

  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Review queue' })).toContainText('AI Fundamentals');

  await page.getByRole('button', { name: 'Got it — mark AI Fundamentals reviewed' }).click();
  await expect(page.getByText('Reviewed “AI Fundamentals”. The next review is')).toBeVisible();
  await expect(page.getByText('No reviews due. “AI Fundamentals” returns on')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Workspace recap' })).toContainText(
    'Reviewed this topic; the next review is',
  );
  await expectNoSeriousA11yViolations(page);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.getByText('No reviews due. “AI Fundamentals” returns on')).toBeVisible();

  const persisted = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dusori = await root.getDirectoryHandle('Dusori');
    const topic = await (
      await dusori.getDirectoryHandle('Topics')
    ).getDirectoryHandle('ai-fundamentals');
    const review = await (await topic.getFileHandle('review.json')).getFile();
    return JSON.parse(await review.text()) as {
      dueOn: string;
      repetition: number;
      schemaVersion: number;
    };
  });
  expect(persisted.schemaVersion).toBe(1);
  expect(persisted.repetition).toBe(0);
  expect(persisted.dueOn >= new Date().toISOString().slice(0, 10)).toBe(true);
});
```

- [ ] **Step 2: Run the new test to verify current behavior**

Run: `pnpm build && pnpm exec playwright test --grep "spaced review schedules"`
Expected with Tasks 1–4 complete: PASS. If executing this task before Task 4 (out of order), expected: FAIL on the "Got it" button — do not proceed that way; Tasks 1–4 come first.

- [ ] **Step 3: Run the full gate**

Run: `pnpm check && pnpm test:e2e`
Expected: PASS — all pre-existing e2e tests (including `learning loop persists roadmap progress, topic status, and Today activity`) must stay green; the queue and recap assertions there are unaffected by the new buttons.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/dusori.spec.ts
git commit -m "test(e2e): cover the spaced review flow"
```

---

### Task 6: Documentation

**Files:**

- Modify: `docs/product/spec.md`
- Modify: `apps/site/src/content/docs/docs/roadmap.md`
- Modify: `README.md`
- Modify: `docs/adr/003-portable-file-contract.md`
- Modify: `CHANGELOG.md`

**Interfaces:**

- Consumes: shipped behavior from Tasks 1–5.
- Produces: nothing further. Version bump / release notes are out of scope (the unmerged research-agent branch decides the next version at merge time).

- [ ] **Step 1: Product spec**

In `docs/product/spec.md`:

1. Append to the numbered "first milestone must prove" list:

```md
19. Optional, explicit spaced-review scheduling stored in portable topic files.
```

2. In the learning-loop paragraph (starts "The shipped learning loop parses ordinary Markdown task syntax"), replace the two sentences:

```md
**Review next** orders active topics before paused topics and then uses oldest `state.json.updatedAt` first.
```

with:

```md
**Review next** orders due spaced reviews first, then unscheduled active topics before paused topics using oldest `state.json.updatedAt` first.
```

and replace the closing sentence:

```md
No deadline, calendar, spaced-repetition interval, or background schedule is generated.
```

with:

```md
An explicit review action ("Got it" or "Needs work") stores a fixed-ladder interval (1, 3, 7, 14, 30, then 60 days) in the topic's machine-owned `review.json` and sets the next due date; a scheduled topic rests out of the queue until due, a topic never marked reviewed keeps the deterministic order, and no calendar, notification, or closed-app schedule is ever generated.
```

3. In "Explicitly not built yet", replace the bullet:

```md
- Generated schedules, due dates, spaced-repetition intervals, or closed-app work
```

with:

```md
- Closed-app or unattended background work
```

- [ ] **Step 2: Site roadmap**

In `apps/site/src/content/docs/docs/roadmap.md`:

1. Under "Shipped in the current build", after the bullet beginning "Interactive Markdown roadmap progress", add:

```md
- Optional spaced review: an explicit "Got it" / "Needs work" action schedules a topic's next due date on the review queue from a fixed interval ladder
```

2. Under "Planned—not built", delete the bullet:

```md
- Optional generated review schedules, due dates, or spaced-repetition intervals
```

- [ ] **Step 3: README**

In `README.md`:

1. In "The product today" table, change the **Today** row description from:

```md
Deterministic review order, seven-day recap, progress, topic state, and next objectives
```

to:

```md
Deterministic review order with optional spaced-review due dates, seven-day recap, progress, topic state, and next objectives
```

2. In the roadmap sentence below the table, change:

```md
Key-based or general web search, Ollama transforms, generated schedules, and unattended work remain roadmap items.
```

to:

```md
Key-based or general web search, Ollama transforms, and unattended work remain roadmap items.
```

3. In the portable file contract tree, after the line `│   ├── research.json               # created after the first dismissal`, add:

```md
    ├── review.json                  # created after the first review action
```

Match the tree's existing indentation and alignment exactly (the `research.json` line is nested the same way).

- [ ] **Step 4: ADR-003 appendix**

In `docs/adr/003-portable-file-contract.md`, after the paragraph that ends "it never uses last-write-wins." (the `research.json` section), add:

```md
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

`review.json` is machine-owned, schema-validated, and written with the storage adapter's expected-hash guard. `repetition` indexes a fixed interval ladder (1, 3, 7, 14, 30, 60 days); `dueOn` is stored rather than derived so a future ladder change never moves an already-made promise. Dates are UTC calendar dates, matching the dated update files. A conflicting write re-reads the current schedule and reapplies the recorded outcome on top of it. Older readers never open the file, and deleting it only forgets the schedule.
```

(Keep the fenced JSON block exactly as shown; the surrounding text is part of the appendix.)

- [ ] **Step 5: Changelog**

In `CHANGELOG.md`, under `## [Unreleased]`, add:

```md
### Added

- Optional spaced review on the **Review next** queue: marking a topic reviewed ("Got it" / "Needs work") schedules its next due date from a fixed 1–60 day interval ladder, stored in a new machine-owned `Topics/<slug>/review.json`. Due topics rise to the top of the queue, scheduled topics rest until due, and topics never marked reviewed keep the existing deterministic order. Review actions append to the dated update log, so they appear in recent activity and the seven-day recap.
```

- [ ] **Step 6: Verify and commit**

Run: `pnpm check`
Expected: PASS (the site build consumes `roadmap.md`; a Markdown or MDX error fails here).

```bash
git add docs/product/spec.md apps/site/src/content/docs/docs/roadmap.md README.md docs/adr/003-portable-file-contract.md CHANGELOG.md
git commit -m "docs: describe optional spaced review"
```
