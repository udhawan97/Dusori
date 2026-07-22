import { z } from 'zod';

import { StorageConflictError, type StorageAdapter } from '../adapters.js';
import { appendTopicUpdate } from '../conflict/write-protocol.js';
import { readMachineFile } from '../schemas/read-machine-file.js';
import { TopicStateSchema, schemaVersion } from '../schemas/workspace.js';
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
      if (!(error instanceof StorageConflictError) || attempt === 2) throw error;
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
