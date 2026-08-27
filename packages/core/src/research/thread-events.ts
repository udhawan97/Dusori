import { z } from 'zod';

import { sha256 } from '../hash.js';

export const maxResearchThreads = 50;
export const maxResearchThreadEvents = 500;
export const maxResearchThreadEventBytes = 256 * 1024;

export const ResearchThreadIdSchema = z.string().regex(/^thread-[a-f0-9]{24}$/u);
export const ResearchThreadEventIdSchema = z.string().regex(/^event-[a-f0-9]{24}$/u);

export const ResearchThreadSchema = z
  .object({
    threadId: ResearchThreadIdSchema,
    parentThreadId: ResearchThreadIdSchema.optional(),
    questionText: z.string().min(1).max(400),
    angleId: z.string().min(1).max(40).optional(),
    outputStyle: z.enum(['brief', 'comparison', 'timeline', 'study-guide']),
    createdAt: z.string().datetime(),
  })
  .passthrough();

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
  .passthrough();

export const ResearchThreadEventSchema = z.discriminatedUnion('type', [
  ResearchThreadEventBaseSchema.extend({
    type: z.literal('question-created'),
    questionText: z.string().min(1).max(400),
  }).passthrough(),
  ResearchThreadEventBaseSchema.extend({
    type: z.literal('follow-up-created'),
    parentThreadId: ResearchThreadIdSchema,
    questionText: z.string().min(1).max(400),
  }).passthrough(),
  ResearchThreadEventBaseSchema.extend({
    type: z.literal('research-completed'),
    runAt: z.string().datetime(),
    eligibleCount: z.number().int().nonnegative(),
    providers: z.array(EventProviderOutcomeSchema).max(24),
  }).passthrough(),
  ResearchThreadEventBaseSchema.extend({
    type: z.literal('source-saved'),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    sourcePath: z.string().min(1).max(640).optional(),
    readState: z.enum(['read', 'readable', 'reference']).optional(),
  }).passthrough(),
  ResearchThreadEventBaseSchema.extend({
    type: z.literal('source-read'),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    sourceContentSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    sourcePath: z.string().min(1).max(640),
    claimCount: z.number().int().positive().max(12),
  }).passthrough(),
  ResearchThreadEventBaseSchema.extend({
    type: z.literal('quote-added'),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    sourcePath: z.string().min(1).max(640),
    notePath: z.string().min(1).max(640),
    quoteSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  }).passthrough(),
  ResearchThreadEventBaseSchema.extend({
    type: z.literal('synthesis-written'),
    runAt: z.string().datetime(),
    artifactPath: z.string().min(1).max(640),
    artifactSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
  }).passthrough(),
  ResearchThreadEventBaseSchema.extend({
    type: z.literal('synthesis-proposed'),
    runAt: z.string().datetime(),
    artifactPath: z.string().min(1).max(640).optional(),
    artifactSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
  }).passthrough(),
  ResearchThreadEventBaseSchema.extend({
    type: z.literal('export-created'),
    format: z.enum(['html', 'markdown', 'pdf']),
    manifestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  }).passthrough(),
]);

export type ResearchThread = z.infer<typeof ResearchThreadSchema>;
export type ResearchThreadEvent = z.infer<typeof ResearchThreadEventSchema>;

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
    };

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

function encodedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/**
 * Keeps the trail finite without dropping the identity event for a retained thread. P0 events do
 * not reference one another, so removing the oldest non-identity event cannot create a dangling
 * reply. Cross-event tombstones remain a P0b concern before reply links ship.
 */
export function boundResearchThreadEvents(
  input: readonly ResearchThreadEvent[],
  retainedThreadIds: ReadonlySet<string>,
): ResearchThreadEvent[] {
  const seen = new Set<string>();
  const events = input.filter((event) => {
    if (!retainedThreadIds.has(event.threadId) || seen.has(event.eventId)) return false;
    seen.add(event.eventId);
    return true;
  });

  while (
    events.length > maxResearchThreadEvents ||
    encodedBytes(events) > maxResearchThreadEventBytes
  ) {
    const removable = events.findIndex(
      (event) => event.type !== 'question-created' && event.type !== 'follow-up-created',
    );
    if (removable < 0) break;
    events.splice(removable, 1);
  }
  return events;
}
