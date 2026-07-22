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
