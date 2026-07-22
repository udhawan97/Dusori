import { describe, expect, it } from 'vitest';

import {
  addDaysUtc,
  markTopicReviewed,
  nextReviewSchedule,
  readReviewSchedule,
  utcDateOf,
  type ReviewSchedule,
} from './review.js';

import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace } from '../workspace/create.js';

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
