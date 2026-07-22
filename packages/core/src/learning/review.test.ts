import { describe, expect, it } from 'vitest';

import {
  addDaysUtc,
  localDateOf,
  markTopicReviewed,
  nextReviewSchedule,
  readReviewSchedule,
  reviewFilePath,
  type ReviewSchedule,
} from './review.js';

import {
  StorageConflictError,
  type FileSnapshot,
  type StorageAdapter,
  type WriteOptions,
} from '../adapters.js';
import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace } from '../workspace/create.js';
import { updateLogPath } from '../workspace/paths.js';

/**
 * Wraps a MemoryStorageAdapter so the FIRST write to `conflictPath` externally
 * mutates that file (simulating a concurrent writer) and throws
 * StorageConflictError. Every later write to that path delegates normally.
 */
class ConflictOnceStorage implements StorageAdapter {
  readonly kind = 'memory' as const;
  private hasConflicted = false;

  constructor(
    private readonly inner: MemoryStorageAdapter,
    private readonly conflictPath: string,
    private readonly externalContent: string,
  ) {}

  ensureDirectory(path: string): Promise<void> {
    return this.inner.ensureDirectory(path);
  }

  list(path?: string, recursive?: boolean) {
    return this.inner.list(path, recursive);
  }

  move(from: string, to: string): Promise<void> {
    return this.inner.move(from, to);
  }

  read(path: string): Promise<FileSnapshot | null> {
    return this.inner.read(path);
  }

  remove(path: string, recursive?: boolean): Promise<void> {
    return this.inner.remove(path, recursive);
  }

  async write(path: string, content: string, options?: WriteOptions): Promise<FileSnapshot> {
    if (!this.hasConflicted && path === this.conflictPath) {
      this.hasConflicted = true;
      await this.inner.externalWrite(path, this.externalContent);
      const current = await this.inner.read(path);
      throw new StorageConflictError(path, options?.expectedHash ?? null, current?.hash ?? null);
    }
    return this.inner.write(path, content, options);
  }
}

/**
 * Wraps a MemoryStorageAdapter so the first `conflictBudget` writes to
 * `conflictPath` throw StorageConflictError with no other effect, then
 * delegates normally. appendTopicUpdate retries itself once internally (2
 * attempts total), so a budget of 2 exhausts ITS retry and makes it throw
 * out to the caller, same as a persistently contested log file would.
 * Counts writes to `countedPath` so tests can assert how many times the
 * review file was actually written.
 */
class ConflictNTimesThenCount implements StorageAdapter {
  readonly kind = 'memory' as const;
  private conflictsLeft: number;
  writeCount = 0;

  constructor(
    private readonly inner: MemoryStorageAdapter,
    private readonly conflictPath: string,
    private readonly countedPath: string,
    conflictBudget: number,
  ) {
    this.conflictsLeft = conflictBudget;
  }

  ensureDirectory(path: string): Promise<void> {
    return this.inner.ensureDirectory(path);
  }

  list(path?: string, recursive?: boolean) {
    return this.inner.list(path, recursive);
  }

  move(from: string, to: string): Promise<void> {
    return this.inner.move(from, to);
  }

  read(path: string): Promise<FileSnapshot | null> {
    return this.inner.read(path);
  }

  remove(path: string, recursive?: boolean): Promise<void> {
    return this.inner.remove(path, recursive);
  }

  async write(path: string, content: string, options?: WriteOptions): Promise<FileSnapshot> {
    if (path === this.countedPath) this.writeCount += 1;
    if (this.conflictsLeft > 0 && path === this.conflictPath) {
      this.conflictsLeft -= 1;
      const current = await this.inner.read(path);
      throw new StorageConflictError(path, options?.expectedHash ?? null, current?.hash ?? null);
    }
    return this.inner.write(path, content, options);
  }
}

// Built from local-time components (not a `Z`-suffixed ISO string) so the
// intended calendar day is unambiguous no matter what timezone the test
// runner is in: nextReviewSchedule now derives the day from local getters.
const on = new Date(2026, 6, 21, 12, 0, 0);

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
    // addDaysUtc is pure YYYY-MM-DD string arithmetic, not timezone-sensitive.
    expect(addDaysUtc('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysUtc('2026-01-30', 3)).toBe('2026-02-02');
    expect(addDaysUtc('2028-02-28', 1)).toBe('2028-02-29');
  });
});

describe('local calendar day', () => {
  it('derives the day from local time components, not UTC', () => {
    expect(localDateOf(new Date(2026, 6, 21, 0, 30))).toBe('2026-07-21');
    expect(localDateOf(new Date(2026, 6, 21, 23, 59))).toBe('2026-07-21');
    expect(localDateOf(new Date(2026, 0, 5, 12, 0))).toBe('2026-01-05');
    expect(localDateOf(new Date(2026, 11, 31, 9, 0))).toBe('2026-12-31');
  });

  // Regression test for the UTC-vs-local bug: a review pressed early in the
  // local morning (e.g. Tokyo, UTC+9) lands on the PREVIOUS calendar day in
  // UTC. The old code stamped lastReviewedOn from `now.toISOString()`, so on
  // any machine east of UTC this moment would have been recorded as July 20,
  // not July 21. Building `now` from local components (not a `Z` string)
  // keeps the expectation honest regardless of the runner's own timezone —
  // localDateOf must read the same local calendar day the learner saw.
  it('stamps lastReviewedOn/dueOn from the local day, matching the local-morning scenario', () => {
    const localMorning = new Date(2026, 6, 21, 0, 1, 0); // 00:01 local time, July 21
    const schedule = nextReviewSchedule(null, 'good', 'ai-fundamentals', localMorning);
    expect(schedule.lastReviewedOn).toBe('2026-07-21');
    expect(schedule.dueOn).toBe('2026-07-22');
  });
});

describe('spaced review persistence', () => {
  // Local-component construction, kept close in time to `created` so the two
  // stay on the same UTC calendar day on any machine (the dated update log
  // path is still UTC-based and unaffected by this fix) while each is
  // unambiguous about its own intended local day.
  const created = new Date(2026, 6, 20, 12, 0, 0);

  it('creates review.json on the first review and logs the outcome', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', created);
    const topic = await createTopic(storage, 'AI Fundamentals', created);

    const schedule = await markTopicReviewed(
      storage,
      topic.topicSlug,
      'good',
      new Date(2026, 6, 20, 13, 0, 0),
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
    await markTopicReviewed(storage, topic.topicSlug, 'good', new Date(2026, 6, 20, 13, 0, 0));

    const secondReview = new Date(2026, 6, 21, 9, 0, 0);
    const schedule = await markTopicReviewed(storage, topic.topicSlug, 'again', secondReview);

    expect(schedule).toMatchObject({ repetition: 0, dueOn: '2026-07-22' });
    // updateLogPath is still UTC-based (dated update logs are unchanged by
    // this fix), so derive the expected path from the same Date instant
    // rather than hardcoding a UTC-day string.
    const log = await storage.read(updateLogPath(topic.topicSlug, secondReview));
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
      new Date(2026, 6, 22, 9, 0, 0),
    );

    expect(schedule).toMatchObject({ repetition: 4, dueOn: '2026-08-21' });
  });

  it('retries the review.json write when it conflicts, recomputing on the conflicting write', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', created);
    const topic = await createTopic(storage, 'AI Fundamentals', created);
    const path = reviewFilePath(topic.topicSlug);

    // Nobody has reviewed yet, so markTopicReviewed's first read sees no
    // review.json. Before its first write lands, a concurrent writer leaves
    // repetition 3 in place; the write must fail, then retry and recompute
    // on top of THAT state, not on top of the empty state first read.
    const external: ReviewSchedule = {
      schemaVersion: 1,
      topicSlug: topic.topicSlug,
      repetition: 3,
      lastReviewedOn: '2026-07-18',
      dueOn: '2026-08-01',
    };
    const conflicting = new ConflictOnceStorage(
      storage,
      path,
      `${JSON.stringify(external, null, 2)}\n`,
    );

    const reviewedAt = new Date(2026, 6, 21, 9, 0, 0);
    const schedule = await markTopicReviewed(conflicting, topic.topicSlug, 'good', reviewedAt);

    expect(schedule).toMatchObject({ repetition: 4, dueOn: '2026-08-20' });
    const file = await storage.read(path);
    expect(JSON.parse(file?.content ?? '{}')).toEqual(schedule);

    const logPath = updateLogPath(topic.topicSlug, reviewedAt);
    const log = await storage.read(logPath);
    const occurrences = (log?.content.match(/- Reviewed this topic; the next review is/gu) ?? [])
      .length;
    expect(occurrences).toBe(1);
  });

  it('surfaces the retry-exhausted message when the review.json write conflicts on all three attempts', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', created);
    const topic = await createTopic(storage, 'AI Fundamentals', created);
    const path = reviewFilePath(topic.topicSlug);
    // Every one of markTopicReviewed's three attempts conflicts, so the loop
    // must exhaust naturally and surface the mandated user-facing message
    // instead of the raw StorageConflictError from the final attempt.
    const conflicting = new ConflictNTimesThenCount(storage, path, path, 3);

    await expect(
      markTopicReviewed(conflicting, topic.topicSlug, 'good', new Date('2026-07-21T09:00:00.000Z')),
    ).rejects.toThrow('The review schedule changed repeatedly. Try marking this review again.');
  });

  it('does not double-apply the outcome when the update-log append exhausts its own retry', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', created);
    const topic = await createTopic(storage, 'AI Fundamentals', created);
    await markTopicReviewed(storage, topic.topicSlug, 'good', new Date('2026-07-20T13:00:00.000Z'));

    const now = new Date('2026-07-21T09:00:00.000Z');
    const logPath = updateLogPath(topic.topicSlug, now);
    const reviewPath = reviewFilePath(topic.topicSlug);
    // appendTopicUpdate has its own 2-attempt retry; conflicting both of its
    // attempts exhausts that budget so it throws StorageConflictError back
    // out to markTopicReviewed, exactly as a persistently contested log file
    // would. The review.json write, one line above it, already succeeded.
    const conflicting = new ConflictNTimesThenCount(storage, logPath, reviewPath, 2);

    await expect(markTopicReviewed(conflicting, topic.topicSlug, 'good', now)).rejects.toThrow(
      StorageConflictError,
    );

    // The review write must not be retried/doubled just because the
    // unrelated log append failed after its own retry was exhausted.
    expect(conflicting.writeCount).toBe(1);
    const file = await storage.read(reviewPath);
    expect(JSON.parse(file?.content ?? '{}')).toMatchObject({ repetition: 1 });

    // The failed append never landed a line.
    expect(await storage.read(logPath)).toBeNull();
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
