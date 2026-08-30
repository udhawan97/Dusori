import { z } from 'zod';

import { sha256 } from '../hash.js';
import { normalizeTags } from '../tags/tags.js';

export const maxResearchThreads = 50;
export const maxResearchThreadEvents = 500;
export const maxResearchThreadEventBytes = 256 * 1024;
export const maxResearchThreadTombstones = 100;
export const maxResearchThreadEventTombstones = 500;

export const ResearchThreadIdSchema = z.string().regex(/^thread-[a-f0-9]{24}$/u);
export const ResearchThreadEventIdSchema = z.string().regex(/^event-[a-f0-9]{24}$/u);

export const ResearchThreadSchema = z
  .object({
    threadId: ResearchThreadIdSchema,
    parentThreadId: ResearchThreadIdSchema.optional(),
    questionText: z.string().min(1).max(400),
    angleId: z.string().min(1).max(40).optional(),
    outputStyle: z.enum(['brief', 'comparison', 'timeline', 'study-guide']),
    tags: z
      .array(z.string().min(1).max(80))
      .max(24)
      .transform((tags) => normalizeTags(tags))
      .optional(),
    createdAt: z.string().datetime(),
    followedAt: z.string().datetime().optional(),
    redactedAt: z.string().datetime().optional(),
  })
  .strict();

export const ResearchThreadTombstoneSchema = z
  .object({
    threadId: ResearchThreadIdSchema,
    at: z.string().datetime(),
    reason: z.enum(['deleted', 'retention']),
  })
  .strict();

export const ResearchThreadEventTombstoneSchema = z
  .object({
    eventId: ResearchThreadEventIdSchema,
    threadId: ResearchThreadIdSchema,
    at: z.string().datetime(),
    reason: z.enum(['compacted', 'thread-deleted']),
  })
  .strict();

const ResearchThreadEventBaseSchema = z.object({
  eventId: ResearchThreadEventIdSchema,
  threadId: ResearchThreadIdSchema,
  at: z.string().datetime(),
});

const EventProviderOutcomeSchema = z
  .object({
    id: z.string().min(1).max(40),
    label: z.string().min(1).max(60),
    outcome: z.enum(['empty', 'failed', 'found']),
    count: z.number().int().nonnegative(),
  })
  .strict();

export const ResearchThreadEventSchema = z.discriminatedUnion('type', [
  ResearchThreadEventBaseSchema.extend({
    type: z.literal('question-created'),
    questionText: z.string().min(1).max(400),
  }).strict(),
  ResearchThreadEventBaseSchema.extend({
    type: z.literal('follow-up-created'),
    parentThreadId: ResearchThreadIdSchema,
    questionText: z.string().min(1).max(400),
  }).strict(),
  ResearchThreadEventBaseSchema.extend({
    type: z.literal('research-completed'),
    runAt: z.string().datetime(),
    eligibleCount: z.number().int().nonnegative(),
    providers: z.array(EventProviderOutcomeSchema).max(24),
  }).strict(),
  ResearchThreadEventBaseSchema.extend({
    type: z.literal('source-saved'),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    sourcePath: z.string().min(1).max(640).optional(),
    readState: z.enum(['read', 'readable', 'reference']).optional(),
  }).strict(),
  ResearchThreadEventBaseSchema.extend({
    type: z.literal('source-read'),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    sourceContentSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    sourcePath: z.string().min(1).max(640),
    claimCount: z.number().int().positive().max(12),
  }).strict(),
  ResearchThreadEventBaseSchema.extend({
    type: z.literal('quote-added'),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    sourcePath: z.string().min(1).max(640),
    notePath: z.string().min(1).max(640),
    quoteSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  }).strict(),
  ResearchThreadEventBaseSchema.extend({
    type: z.literal('note-added'),
    notePath: z.string().min(1).max(640),
    noteSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    sourcePath: z.string().min(1).max(640),
    quoteSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    replyToEventId: ResearchThreadEventIdSchema.optional(),
  }).strict(),
  ResearchThreadEventBaseSchema.extend({
    type: z.literal('synthesis-written'),
    runAt: z.string().datetime(),
    artifactPath: z.string().min(1).max(640),
    artifactSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
  }).strict(),
  ResearchThreadEventBaseSchema.extend({
    type: z.literal('synthesis-proposed'),
    runAt: z.string().datetime(),
    artifactPath: z.string().min(1).max(640).optional(),
    artifactSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
  }).strict(),
  ResearchThreadEventBaseSchema.extend({
    type: z.literal('export-created'),
    format: z.enum(['html', 'markdown', 'pdf']),
    manifestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  }).strict(),
  ResearchThreadEventBaseSchema.extend({
    type: z.literal('thread-redacted'),
  }).strict(),
]);

export type ResearchThread = z.infer<typeof ResearchThreadSchema>;
export type ResearchThreadTombstone = z.infer<typeof ResearchThreadTombstoneSchema>;
export type ResearchThreadEvent = z.infer<typeof ResearchThreadEventSchema>;
export type ResearchThreadEventTombstone = z.infer<typeof ResearchThreadEventTombstoneSchema>;

export type ResearchThreadEventInput =
  | {
      type: 'source-saved';
      sourceSha256: string;
      sourcePath?: string;
      readState?: 'read' | 'readable' | 'reference';
    }
  | {
      type: 'source-read';
      sourceSha256: string;
      sourceContentSha256: string;
      sourcePath: string;
      claimCount: number;
    }
  | {
      type: 'quote-added';
      sourceSha256: string;
      sourcePath: string;
      notePath: string;
      quoteSha256: string;
    }
  | {
      type: 'note-added';
      notePath: string;
      noteSha256: string;
      sourceSha256: string;
      sourcePath: string;
      quoteSha256?: string;
      replyToEventId?: string;
    }
  | {
      type: 'export-created';
      format: 'html' | 'markdown' | 'pdf';
      manifestSha256: string;
    };

export type ResearchThreadEventDetails =
  | ResearchThreadEventInput
  | { type: 'question-created'; questionText: string }
  | {
      type: 'follow-up-created';
      parentThreadId: string;
      questionText: string;
    }
  | {
      type: 'research-completed';
      runAt: string;
      eligibleCount: number;
      providers: Array<{
        id: string;
        label: string;
        outcome: 'empty' | 'failed' | 'found';
        count: number;
      }>;
    }
  | {
      type: 'synthesis-written';
      runAt: string;
      artifactPath: string;
      artifactSha256?: string;
    }
  | {
      type: 'synthesis-proposed';
      runAt: string;
      artifactPath?: string;
      artifactSha256?: string;
    }
  | { type: 'thread-redacted' };

export async function researchThreadId(
  topicSlug: string,
  questionText: string,
  createdAt: string,
): Promise<string> {
  return `thread-${(await sha256(`${topicSlug}\n${createdAt}\n${questionText}`)).slice(0, 24)}`;
}

export async function researchThreadEventId(
  threadId: string,
  at: string,
  details: object,
): Promise<string> {
  return `event-${(await sha256(`${threadId}\n${at}\n${JSON.stringify(details)}`)).slice(0, 24)}`;
}

export function researchThreadEventBytes(value: readonly ResearchThreadEvent[]): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function isIdentityEvent(event: ResearchThreadEvent): boolean {
  return event.type === 'question-created' || event.type === 'follow-up-created';
}

function replyTarget(event: ResearchThreadEvent): string | undefined {
  return event.type === 'note-added' ? event.replyToEventId : undefined;
}

export type ResearchThreadTargetState = 'available' | 'missing' | 'tombstone';

export function researchThreadParentState(
  thread: ResearchThread,
  liveThreadIds: ReadonlySet<string>,
  tombstones: readonly ResearchThreadTombstone[],
): ResearchThreadTargetState | undefined {
  if (!thread.parentThreadId) return undefined;
  if (liveThreadIds.has(thread.parentThreadId)) return 'available';
  return tombstones.some((item) => item.threadId === thread.parentThreadId)
    ? 'tombstone'
    : 'missing';
}

export function researchThreadReplyState(
  event: ResearchThreadEvent,
  liveEventIds: ReadonlySet<string>,
  tombstones: readonly ResearchThreadEventTombstone[],
): ResearchThreadTargetState | undefined {
  const target = replyTarget(event);
  if (!target) return undefined;
  if (liveEventIds.has(target)) return 'available';
  return tombstones.some((item) => item.eventId === target) ? 'tombstone' : 'missing';
}

export interface BoundedResearchThreadActivity {
  events: ResearchThreadEvent[];
  eventTombstones: ResearchThreadEventTombstone[];
}

/**
 * Keeps the trail finite without dropping retained thread identities. If compaction or thread
 * deletion removes an event that a retained note replies to, a payload-free tombstone preserves
 * the distinction between an intentionally removed target and a broken link.
 */
export function boundResearchThreadActivity(
  input: readonly ResearchThreadEvent[],
  retainedThreadIds: ReadonlySet<string>,
  existingTombstones: readonly ResearchThreadEventTombstone[] = [],
  removedReason: ResearchThreadEventTombstone['reason'] = 'compacted',
): BoundedResearchThreadActivity {
  const seen = new Set<string>();
  const identityThreads = new Set<string>();
  const removed = new Map<string, ResearchThreadEvent>();
  const events = input.filter((event) => {
    const duplicateIdentity = isIdentityEvent(event) && identityThreads.has(event.threadId);
    if (!retainedThreadIds.has(event.threadId) || seen.has(event.eventId) || duplicateIdentity) {
      removed.set(event.eventId, event);
      return false;
    }
    seen.add(event.eventId);
    if (isIdentityEvent(event)) identityThreads.add(event.threadId);
    return true;
  });

  while (
    events.length > maxResearchThreadEvents ||
    researchThreadEventBytes(events) > maxResearchThreadEventBytes
  ) {
    const removable = events.findIndex((event) => !isIdentityEvent(event));
    if (removable < 0) break;
    const [event] = events.splice(removable, 1);
    if (event) removed.set(event.eventId, event);
  }

  const liveIds = new Set(events.map((event) => event.eventId));
  const oldTombstones = new Map(existingTombstones.map((item) => [item.eventId, item]));
  const referencedIds = new Set(
    events.map(replyTarget).filter((eventId): eventId is string => Boolean(eventId)),
  );
  const eventTombstones: ResearchThreadEventTombstone[] = [];
  for (const eventId of referencedIds) {
    if (liveIds.has(eventId)) continue;
    const prior = oldTombstones.get(eventId);
    const pruned = removed.get(eventId);
    if (prior) eventTombstones.push(prior);
    else if (pruned) {
      eventTombstones.push(
        ResearchThreadEventTombstoneSchema.parse({
          at: pruned.at,
          eventId: pruned.eventId,
          reason: removedReason,
          threadId: pruned.threadId,
        }),
      );
    }
  }

  return {
    events,
    eventTombstones: eventTombstones.slice(-maxResearchThreadEventTombstones),
  };
}

export function boundResearchThreadEvents(
  input: readonly ResearchThreadEvent[],
  retainedThreadIds: ReadonlySet<string>,
): ResearchThreadEvent[] {
  return boundResearchThreadActivity(input, retainedThreadIds).events;
}
