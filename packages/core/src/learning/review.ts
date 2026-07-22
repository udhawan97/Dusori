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
