import { z } from 'zod';

import { StorageConflictError, type StorageAdapter } from '../adapters.js';
import { readProposalLedger } from '../conflict/proposal-ledger.js';
import { readMachineFile } from '../schemas/read-machine-file.js';
import { TopicStateSchema, schemaVersion } from '../schemas/workspace.js';
import { clearSynthesisStale } from '../sources/import.js';
import { topicRoot } from '../workspace/paths.js';
import {
  ResearchThreadEventSchema,
  ResearchThreadEventTombstoneSchema,
  ResearchThreadSchema,
  ResearchThreadTombstoneSchema,
  boundResearchThreadActivity,
  maxResearchThreadEventBytes,
  maxResearchThreadEvents,
  maxResearchThreads,
  maxResearchThreadEventTombstones,
  maxResearchThreadTombstones,
  researchThreadEventBytes,
  researchThreadEventId,
  researchThreadId,
  type ResearchThread,
  type ResearchThreadEvent,
  type ResearchThreadEventDetails,
  type ResearchThreadEventInput,
  type ResearchThreadTombstone,
} from './thread-events.js';

export const DismissedResearchSuggestionSchema = z
  .object({
    key: z.string().min(1).max(320),
    title: z.string().min(1).max(160),
    at: z.string().datetime(),
    // Optional: a catalog candidate is keyed `mslearn:<uid>`, a ranked-search
    // candidate `mslearn:<url>` (the ranked API returns no uid). The URL is the
    // one thing stable across both, so it's kept alongside the key to match a
    // dismissal regardless of which path produced the candidate.
    url: z.url().max(2048).optional(),
  })
  .passthrough();

// One candidate a past run already showed. `at` is when it was first seen, so a
// candidate missing from this list is genuinely new since the last run.
export const SeenResearchCandidateSchema = z
  .object({
    at: z.string().datetime(),
    key: z.string().min(1).max(320),
    url: z.url().max(2048).optional(),
  })
  .passthrough();

// What one provider did in one run. `count` is candidates returned before ranking, so a
// provider that answered with nothing is `empty` with 0 — never confused with `failed`.
export const RunProviderOutcomeSchema = z
  .object({
    id: z.string().min(1).max(40),
    label: z.string().min(1).max(60),
    outcome: z.enum(['empty', 'failed', 'found']),
    count: z.number().int().nonnegative(),
    message: z.string().min(1).max(300).optional(),
  })
  .passthrough();

export const ResearchRunRecordSchema = z
  .object({
    at: z.string().datetime(),
    searchText: z.string().min(1).max(400),
    /** The question shown to the user, separate from the provider-expanded search payload. */
    questionText: z.string().min(1).max(400).optional(),
    angleId: z.string().min(1).max(40).optional(),
    providers: z.array(RunProviderOutcomeSchema).max(24),
    newKeys: z.number().int().nonnegative(),
    /** Ranked, topic-relevant results retained after eligibility filtering. */
    eligibleCount: z.number().int().nonnegative().optional(),
    /** Whether this run replaced Synthesis.md or only produced a conflict proposal. */
    synthesisOutcome: z.enum(['kept', 'proposed', 'written']).optional(),
    /** Stable identity of the user-facing question thread. Missing only on legacy runs. */
    threadId: z
      .string()
      .regex(/^thread-[a-f0-9]{24}$/u)
      .optional(),
  })
  .passthrough();

export const ResearchOutputStyleSchema = z.enum(['brief', 'comparison', 'timeline', 'study-guide']);
export type ResearchOutputStyle = z.infer<typeof ResearchOutputStyleSchema>;

export const ResearchFileSchema = z
  .object({
    schemaVersion: z.literal(schemaVersion),
    topicSlug: z.string().min(1).max(80),
    dismissed: z.array(DismissedResearchSuggestionSchema),
    // Optional so every research.json written before run memory existed still
    // parses unchanged, which is why adding them needs no schemaVersion bump.
    lastRunAt: z.string().datetime().optional(),
    seen: z.array(SeenResearchCandidateSchema).optional(),
    runs: z.array(ResearchRunRecordSchema).optional(),
    /** Standing permission to re-scan this topic when it is stale and Dusori is opened. */
    autoRefresh: z.boolean().optional(),
    /** Learner-selected structure for the durable Synthesis.md artifact. */
    outputStyle: ResearchOutputStyleSchema.optional(),
    /** The run whose answer is currently stored in Synthesis.md. */
    synthesisRunAt: z.string().datetime().optional(),
    /** Additive P0 thread identity. Legacy runs remain outside this collection. */
    threads: z.array(ResearchThreadSchema).max(maxResearchThreads).optional(),
    /** Bounded typed activity; discovery and generated artifacts remain distinct from evidence. */
    events: z.array(ResearchThreadEventSchema).max(maxResearchThreadEvents).optional(),
    /** Minimal targets retained only while a live event replies to compacted activity. */
    eventTombstones: z
      .array(ResearchThreadEventTombstoneSchema)
      .max(maxResearchThreadEventTombstones)
      .optional(),
    /** Question-free identity markers for deleted or retention-pruned thread parents. */
    threadTombstones: z
      .array(ResearchThreadTombstoneSchema)
      .max(maxResearchThreadTombstones)
      .optional(),
    activeThreadId: z
      .string()
      .regex(/^thread-[a-f0-9]{24}$/u)
      .optional(),
  })
  .passthrough()
  .superRefine((research, context) => {
    if (researchThreadEventBytes(research.events ?? []) <= maxResearchThreadEventBytes) return;
    context.addIssue({
      code: 'custom',
      message: 'Research activity exceeds the 256 KiB event budget.',
      path: ['events'],
    });
  });

export type DismissedResearchSuggestion = z.infer<typeof DismissedResearchSuggestionSchema>;
export type SeenResearchCandidate = z.infer<typeof SeenResearchCandidateSchema>;
export type RunProviderOutcome = z.infer<typeof RunProviderOutcomeSchema>;
export type ResearchRunRecord = z.infer<typeof ResearchRunRecordSchema>;
export type ResearchFile = z.infer<typeof ResearchFileSchema>;

/** Keeps the file bounded; oldest entries are dropped first. */
const maxSeenEntries = 500;

/** Same bounding rule for the run trail; fifty runs is far more history than a topic needs. */
const maxRunEntries = 50;

// Normalizes a URL for comparison so equivalent references (e.g. differing
// only in how the URL constructor formats them) match. Falls back to the raw
// string for anything unparseable rather than throwing.
export function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(?:utm_.+|fbclid|gclid|mc_cid|mc_eid)$/iu.test(key)) parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export function researchFilePath(topicSlug: string): string {
  return `${topicRoot(topicSlug)}/research.json`;
}

export async function readResearchFile(
  storage: StorageAdapter,
  topicSlug: string,
  now = new Date(),
): Promise<ResearchFile | null> {
  const root = topicRoot(topicSlug);
  await readMachineFile(storage, `${root}/state.json`, TopicStateSchema, now);
  const path = `${root}/research.json`;
  if (!(await storage.read(path))) return null;
  return readMachineFile(storage, path, ResearchFileSchema, now);
}

export async function writeDismissedResearchSuggestion(
  storage: StorageAdapter,
  topicSlug: string,
  suggestion: { key: string; title: string; url?: string },
  now = new Date(),
): Promise<ResearchFile> {
  const normalizedSlug = topicRoot(topicSlug).slice('Topics/'.length);
  const path = researchFilePath(topicSlug);
  await readMachineFile(storage, `${topicRoot(topicSlug)}/state.json`, TopicStateSchema, now);
  const dismissal = DismissedResearchSuggestionSchema.parse({
    at: now.toISOString(),
    key: suggestion.key,
    title: suggestion.title,
    url: suggestion.url,
  });
  const dismissalUrl = dismissal.url ? canonicalUrl(dismissal.url) : null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const currentSnapshot = await storage.read(path);
    const current = currentSnapshot
      ? await readMachineFile(storage, path, ResearchFileSchema, now)
      : ResearchFileSchema.parse({ dismissed: [], schemaVersion, topicSlug: normalizedSlug });
    const alreadyDismissed = current.dismissed.some(
      (item) =>
        item.key === dismissal.key ||
        (dismissalUrl !== null &&
          item.url !== undefined &&
          canonicalUrl(item.url) === dismissalUrl),
    );
    if (alreadyDismissed) return current;
    const next = ResearchFileSchema.parse({
      ...current,
      dismissed: [...current.dismissed, dismissal],
    });
    try {
      await storage.write(path, `${JSON.stringify(next, null, 2)}\n`, {
        expectedHash: currentSnapshot?.hash ?? null,
      });
      return next;
    } catch (error) {
      if (!(error instanceof StorageConflictError)) throw error;
    }
  }

  throw new Error('Research dismissals changed repeatedly. Try dismissing this suggestion again.');
}

export interface ResearchRunInput {
  searchText: string;
  questionText?: string;
  angleId?: string;
  providers: RunProviderOutcome[];
  /** Ranked candidates that survived dedupe; empty on a failed or genuinely empty run. */
  candidates: { key: string; url?: string }[];
  /** Ranked, topic-relevant results retained after eligibility filtering. */
  eligibleCount?: number;
  /** Explicit only for a learner-created follow-up; ordinary refreshes reuse the same thread. */
  parentThreadId?: string;
}

interface RetainedThreadState {
  threads: ResearchThread[];
  threadTombstones: ResearchThreadTombstone[];
}

function boundThreadTombstones(
  threads: readonly ResearchThread[],
  existing: readonly ResearchThreadTombstone[],
  additions: readonly ResearchThreadTombstone[],
): ResearchThreadTombstone[] {
  const liveIds = new Set(threads.map((thread) => thread.threadId));
  const requiredIds = new Set(
    threads
      .map((thread) => thread.parentThreadId)
      .filter((threadId): threadId is string => threadId !== undefined)
      .filter((threadId) => !liveIds.has(threadId)),
  );
  const merged = new Map<string, ResearchThreadTombstone>();
  for (const item of [...existing, ...additions]) {
    if (!liveIds.has(item.threadId)) merged.set(item.threadId, item);
  }
  return [...merged.values()]
    .filter((item) => requiredIds.has(item.threadId))
    .sort((left, right) => left.at.localeCompare(right.at))
    .slice(-maxResearchThreadTombstones);
}

function retainedThreadState(
  threads: readonly ResearchThread[],
  tombstones: readonly ResearchThreadTombstone[],
  at: string,
  next?: ResearchThread,
): RetainedThreadState {
  const merged = next
    ? [...threads.filter((thread) => thread.threadId !== next.threadId), next]
    : [...threads];
  const retained = merged.slice(-maxResearchThreads);
  const removed = merged.slice(0, Math.max(0, merged.length - maxResearchThreads));
  return {
    threads: retained,
    threadTombstones: boundThreadTombstones(
      retained,
      tombstones,
      removed.map((thread) =>
        ResearchThreadTombstoneSchema.parse({ at, reason: 'retention', threadId: thread.threadId }),
      ),
    ),
  };
}

async function eventFor(
  threadId: string,
  at: string,
  details: ResearchThreadEventDetails,
): Promise<ResearchThreadEvent> {
  return ResearchThreadEventSchema.parse({
    ...details,
    at,
    eventId: await researchThreadEventId(threadId, at, details),
    threadId,
  });
}

function researchEventAlreadyRecorded(
  events: readonly ResearchThreadEvent[],
  input: ResearchThreadEventInput,
  threadId: string,
): boolean {
  return events.some((event) => {
    if (event.threadId !== threadId || event.type !== input.type) return false;
    if (event.type === 'export-created' && input.type === 'export-created') {
      return event.manifestSha256 === input.manifestSha256;
    }
    if (event.type === 'quote-added' && input.type === 'quote-added') {
      return event.notePath === input.notePath && event.quoteSha256 === input.quoteSha256;
    }
    if (event.type === 'note-added' && input.type === 'note-added') {
      return event.notePath === input.notePath && event.noteSha256 === input.noteSha256;
    }
    if (event.type === 'source-read' && input.type === 'source-read') {
      return (
        event.sourceSha256 === input.sourceSha256 &&
        event.sourceContentSha256 === input.sourceContentSha256 &&
        event.claimCount === input.claimCount
      );
    }
    if (event.type === 'source-saved' && input.type === 'source-saved') {
      return event.sourceSha256 === input.sourceSha256 && event.readState === input.readState;
    }
    return false;
  });
}

/** Records a secondary activity event without inventing a thread for legacy-only topics. */
export async function recordResearchThreadEvent(
  storage: StorageAdapter,
  topicSlug: string,
  input: ResearchThreadEventInput,
  now = new Date(),
  threadId?: string,
): Promise<ResearchFile | null> {
  const path = researchFilePath(topicSlug);
  await readMachineFile(storage, `${topicRoot(topicSlug)}/state.json`, TopicStateSchema, now);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const snapshot = await storage.read(path);
    if (!snapshot) return null;
    const current = await readMachineFile(storage, path, ResearchFileSchema, now);
    const targetThreadId = threadId ?? current.activeThreadId;
    if (
      !targetThreadId ||
      !(current.threads ?? []).some((item) => item.threadId === targetThreadId)
    ) {
      return current;
    }
    const existing = current.events ?? [];
    if (researchEventAlreadyRecorded(existing, input, targetThreadId)) return current;
    const resolvedInput =
      input.type === 'note-added' && !input.replyToEventId
        ? {
            ...input,
            ...(() => {
              const target = [...existing]
                .reverse()
                .find(
                  (event) =>
                    (event.type === 'source-read' || event.type === 'source-saved') &&
                    event.sourcePath === input.sourcePath &&
                    event.sourceSha256 === input.sourceSha256,
                );
              return target ? { replyToEventId: target.eventId } : {};
            })(),
          }
        : input;
    const event = await eventFor(targetThreadId, now.toISOString(), resolvedInput);
    const retainedIds = new Set((current.threads ?? []).map((item) => item.threadId));
    const activity = boundResearchThreadActivity(
      [...existing, event],
      retainedIds,
      current.eventTombstones ?? [],
    );
    const next = ResearchFileSchema.parse({
      ...current,
      eventTombstones: activity.eventTombstones,
      events: activity.events,
    });
    try {
      await storage.write(path, `${JSON.stringify(next, null, 2)}\n`, {
        expectedHash: snapshot.hash,
      });
      return next;
    } catch (error) {
      if (!(error instanceof StorageConflictError)) throw error;
    }
  }

  throw new Error('Research activity changed repeatedly. Try the action again.');
}

export async function setResearchThreadFollowed(
  storage: StorageAdapter,
  topicSlug: string,
  threadId: string,
  followed: boolean,
  now = new Date(),
): Promise<ResearchFile> {
  const path = researchFilePath(topicSlug);
  await readMachineFile(storage, `${topicRoot(topicSlug)}/state.json`, TopicStateSchema, now);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const snapshot = await storage.read(path);
    if (!snapshot) throw new Error('The research thread no longer exists.');
    const current = await readMachineFile(storage, path, ResearchFileSchema, now);
    const target = (current.threads ?? []).find((thread) => thread.threadId === threadId);
    if (!target) throw new Error('The research thread no longer exists.');
    if (followed === Boolean(target.followedAt)) return current;
    const threads = (current.threads ?? []).map((thread) => {
      if (thread.threadId !== threadId) return thread;
      if (followed) return ResearchThreadSchema.parse({ ...thread, followedAt: now.toISOString() });
      const { followedAt: _followedAt, ...unfollowed } = thread;
      void _followedAt;
      return ResearchThreadSchema.parse(unfollowed);
    });
    const next = ResearchFileSchema.parse({ ...current, threads });
    try {
      await storage.write(path, `${JSON.stringify(next, null, 2)}\n`, {
        expectedHash: snapshot.hash,
      });
      return next;
    } catch (error) {
      if (!(error instanceof StorageConflictError)) throw error;
    }
  }

  throw new Error('Research follow state changed repeatedly. Try again.');
}

const redactedQuestion = 'Redacted question';
const redactedSearch = 'Redacted research query';

export async function redactResearchThread(
  storage: StorageAdapter,
  topicSlug: string,
  threadId: string,
  now = new Date(),
): Promise<ResearchFile> {
  const path = researchFilePath(topicSlug);
  await readMachineFile(storage, `${topicRoot(topicSlug)}/state.json`, TopicStateSchema, now);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const snapshot = await storage.read(path);
    if (!snapshot) throw new Error('The research thread no longer exists.');
    const current = await readMachineFile(storage, path, ResearchFileSchema, now);
    const target = (current.threads ?? []).find((thread) => thread.threadId === threadId);
    if (!target) throw new Error('The research thread no longer exists.');
    if (target.redactedAt) return current;
    const at = now.toISOString();
    const threads = (current.threads ?? []).map((thread) =>
      thread.threadId === threadId
        ? ResearchThreadSchema.parse({ ...thread, questionText: redactedQuestion, redactedAt: at })
        : thread,
    );
    const runs = (current.runs ?? []).map((run) => {
      if (run.threadId !== threadId) return run;
      return ResearchRunRecordSchema.parse({
        at: run.at,
        angleId: run.angleId,
        eligibleCount: run.eligibleCount,
        newKeys: run.newKeys,
        providers: run.providers.map(({ count, id, label, outcome }) => ({
          count,
          id,
          label,
          outcome,
        })),
        questionText: redactedQuestion,
        searchText: redactedSearch,
        synthesisOutcome: run.synthesisOutcome,
        threadId: run.threadId,
      });
    });
    const scrubbedEvents = (current.events ?? []).map((event) => {
      if (event.threadId !== threadId) return event;
      if (event.type === 'question-created') {
        return ResearchThreadEventSchema.parse({ ...event, questionText: redactedQuestion });
      }
      if (event.type === 'follow-up-created') {
        return ResearchThreadEventSchema.parse({ ...event, questionText: redactedQuestion });
      }
      return event;
    });
    scrubbedEvents.push(await eventFor(threadId, at, { type: 'thread-redacted' }));
    const retainedIds = new Set(threads.map((thread) => thread.threadId));
    const activity = boundResearchThreadActivity(
      scrubbedEvents,
      retainedIds,
      current.eventTombstones ?? [],
    );
    const next = ResearchFileSchema.parse({
      ...current,
      eventTombstones: activity.eventTombstones,
      events: activity.events,
      runs,
      threads,
    });
    try {
      await storage.write(path, `${JSON.stringify(next, null, 2)}\n`, {
        expectedHash: snapshot.hash,
      });
      return next;
    } catch (error) {
      if (!(error instanceof StorageConflictError)) throw error;
    }
  }

  throw new Error('Research redaction changed repeatedly. Try again.');
}

export async function deleteResearchThread(
  storage: StorageAdapter,
  topicSlug: string,
  threadId: string,
  now = new Date(),
): Promise<ResearchFile> {
  const path = researchFilePath(topicSlug);
  await readMachineFile(storage, `${topicRoot(topicSlug)}/state.json`, TopicStateSchema, now);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const snapshot = await storage.read(path);
    if (!snapshot) throw new Error('The research thread no longer exists.');
    const current = await readMachineFile(storage, path, ResearchFileSchema, now);
    const target = (current.threads ?? []).find((thread) => thread.threadId === threadId);
    if (!target) throw new Error('The research thread no longer exists.');
    const at = now.toISOString();
    const threads = (current.threads ?? []).filter((thread) => thread.threadId !== threadId);
    const removedRunTimes = new Set(
      (current.runs ?? []).filter((run) => run.threadId === threadId).map((run) => run.at),
    );
    const runs = (current.runs ?? []).filter((run) => run.threadId !== threadId);
    const retainedIds = new Set(threads.map((thread) => thread.threadId));
    const activity = boundResearchThreadActivity(
      current.events ?? [],
      retainedIds,
      current.eventTombstones ?? [],
      'thread-deleted',
    );
    const threadTombstones = boundThreadTombstones(threads, current.threadTombstones ?? [], [
      ResearchThreadTombstoneSchema.parse({ at, reason: 'deleted', threadId }),
    ]);
    const next = ResearchFileSchema.parse({
      ...current,
      activeThreadId:
        current.activeThreadId === threadId ? threads.at(-1)?.threadId : current.activeThreadId,
      eventTombstones: activity.eventTombstones,
      events: activity.events,
      lastRunAt: runs.at(-1)?.at,
      runs,
      synthesisRunAt:
        current.synthesisRunAt && removedRunTimes.has(current.synthesisRunAt)
          ? undefined
          : current.synthesisRunAt,
      threadTombstones,
      threads,
    });
    try {
      await storage.write(path, `${JSON.stringify(next, null, 2)}\n`, {
        expectedHash: snapshot.hash,
      });
      return next;
    } catch (error) {
      if (!(error instanceof StorageConflictError)) throw error;
    }
  }

  throw new Error('Research deletion changed repeatedly. Try again.');
}

export async function recordResearchRun(
  storage: StorageAdapter,
  topicSlug: string,
  run: ResearchRunInput,
  now = new Date(),
): Promise<ResearchFile> {
  const normalizedSlug = topicRoot(topicSlug).slice('Topics/'.length);
  const path = researchFilePath(topicSlug);
  await readMachineFile(storage, `${topicRoot(topicSlug)}/state.json`, TopicStateSchema, now);
  const at = now.toISOString();
  const questionText = (run.questionText ?? run.searchText).trim();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const currentSnapshot = await storage.read(path);
    const current = currentSnapshot
      ? await readMachineFile(storage, path, ResearchFileSchema, now)
      : ResearchFileSchema.parse({ dismissed: [], schemaVersion, topicSlug: normalizedSlug });
    const threads = current.threads ?? [];
    const activeThread = threads.find((thread) => thread.threadId === current.activeThreadId);
    const reusableThread =
      !run.parentThreadId && activeThread?.questionText === questionText ? activeThread : undefined;
    const newThread = reusableThread
      ? undefined
      : ResearchThreadSchema.parse({
          angleId: run.angleId,
          createdAt: at,
          outputStyle: current.outputStyle ?? 'brief',
          parentThreadId: run.parentThreadId,
          questionText,
          threadId: await researchThreadId(normalizedSlug, questionText, at),
        });
    if (run.parentThreadId && !threads.some((thread) => thread.threadId === run.parentThreadId)) {
      throw new Error('The parent research thread no longer exists. Start a new question instead.');
    }
    const thread = reusableThread ?? newThread!;
    // An already-seen key keeps its original `at`: re-stamping it every run
    // would make nothing ever count as new again.
    const merged = new Map((current.seen ?? []).map((entry) => [entry.key, entry]));
    let newKeys = 0;
    for (const candidate of run.candidates) {
      if (merged.has(candidate.key)) continue;
      newKeys += 1;
      merged.set(candidate.key, { at, key: candidate.key, url: candidate.url });
    }
    const record = ResearchRunRecordSchema.parse({
      angleId: run.angleId,
      at,
      eligibleCount: run.eligibleCount ?? run.candidates.length,
      newKeys,
      providers: run.providers,
      questionText: run.questionText,
      searchText: run.searchText,
      threadId: thread.threadId,
    });
    const retained = retainedThreadState(threads, current.threadTombstones ?? [], at, newThread);
    const retainedIds = new Set(retained.threads.map((item) => item.threadId));
    const identityEvent = newThread
      ? await eventFor(thread.threadId, at, {
          ...(thread.parentThreadId
            ? { parentThreadId: thread.parentThreadId, type: 'follow-up-created' as const }
            : { type: 'question-created' as const }),
          questionText,
        })
      : undefined;
    const runEvent = await eventFor(thread.threadId, at, {
      eligibleCount: record.eligibleCount ?? 0,
      providers: record.providers.map(({ count, id, label, outcome }) => ({
        count,
        id,
        label,
        outcome,
      })),
      runAt: at,
      type: 'research-completed',
    });
    const activity = boundResearchThreadActivity(
      [...(current.events ?? []), ...(identityEvent ? [identityEvent] : []), runEvent],
      retainedIds,
      current.eventTombstones ?? [],
    );
    const next = ResearchFileSchema.parse({
      ...current,
      activeThreadId: thread.threadId,
      eventTombstones: activity.eventTombstones,
      events: activity.events,
      lastRunAt: at,
      runs: [...(current.runs ?? []), record].slice(-maxRunEntries),
      seen: [...merged.values()]
        .sort((left, right) => left.at.localeCompare(right.at))
        .slice(-maxSeenEntries),
      threadTombstones: retained.threadTombstones,
      threads: retained.threads,
    });
    try {
      await storage.write(path, `${JSON.stringify(next, null, 2)}\n`, {
        expectedHash: currentSnapshot?.hash ?? null,
      });
      return next;
    } catch (error) {
      if (!(error instanceof StorageConflictError)) throw error;
    }
  }

  throw new Error('Research run history changed repeatedly. Try running research again.');
}

function runHasResults(run: ResearchRunRecord): boolean {
  return (
    (run.eligibleCount ?? run.providers.reduce((total, provider) => total + provider.count, 0)) > 0
  );
}

/**
 * Durably associates the current Synthesis.md with the run that produced it. A conflict marks
 * the later run as a non-replacing proposal while retaining the earlier answer association.
 */
export async function recordResearchSynthesisOutcome(
  storage: StorageAdapter,
  topicSlug: string,
  runAt: string,
  outcome: 'kept' | 'proposed' | 'written',
  now = new Date(),
  artifactPath?: string,
): Promise<ResearchFile> {
  const path = researchFilePath(topicSlug);
  await readMachineFile(storage, `${topicRoot(topicSlug)}/state.json`, TopicStateSchema, now);
  const resolvedArtifactPath =
    artifactPath ?? (outcome === 'written' ? `${topicRoot(topicSlug)}/Synthesis.md` : undefined);
  const artifact = resolvedArtifactPath ? await storage.read(resolvedArtifactPath) : null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const currentSnapshot = await storage.read(path);
    if (!currentSnapshot) throw new Error('The research run no longer exists.');
    const current = await readMachineFile(storage, path, ResearchFileSchema, now);
    const runs = [...(current.runs ?? [])];
    let targetIndex = -1;
    for (let index = runs.length - 1; index >= 0; index -= 1) {
      if (runs[index]?.at === runAt) {
        targetIndex = index;
        break;
      }
    }
    if (targetIndex < 0) throw new Error('The research run no longer exists.');

    runs[targetIndex] = ResearchRunRecordSchema.parse({
      ...runs[targetIndex],
      synthesisOutcome: outcome,
    });
    let synthesisRunAt = current.synthesisRunAt;
    if (outcome === 'written') {
      synthesisRunAt = runAt;
    } else if (!synthesisRunAt) {
      // Upgrade older ledgers on the first conflict: the existing synthesis necessarily predates
      // this proposal, so bind it to the nearest earlier result-bearing run instead of the new one.
      for (let index = targetIndex - 1; index >= 0; index -= 1) {
        const prior = runs[index];
        if (!prior || !runHasResults(prior)) continue;
        runs[index] = ResearchRunRecordSchema.parse({
          ...prior,
          synthesisOutcome: prior.synthesisOutcome ?? 'written',
        });
        synthesisRunAt = prior.at;
        break;
      }
    }

    const targetRun = runs[targetIndex]!;
    const events = [...(current.events ?? [])];
    if (targetRun.threadId && outcome !== 'kept') {
      const artifactFields = {
        ...(resolvedArtifactPath ? { artifactPath: resolvedArtifactPath } : {}),
        ...(artifact ? { artifactSha256: artifact.hash } : {}),
      };
      events.push(
        await eventFor(
          targetRun.threadId,
          now.toISOString(),
          outcome === 'written'
            ? {
                ...artifactFields,
                artifactPath: resolvedArtifactPath!,
                runAt,
                type: 'synthesis-written',
              }
            : { ...artifactFields, runAt, type: 'synthesis-proposed' },
        ),
      );
    }
    const retainedIds = new Set((current.threads ?? []).map((thread) => thread.threadId));
    const activity = boundResearchThreadActivity(
      events,
      retainedIds,
      current.eventTombstones ?? [],
    );
    const next = ResearchFileSchema.parse({
      ...current,
      eventTombstones: activity.eventTombstones,
      events: activity.events,
      runs,
      synthesisRunAt,
    });
    try {
      await storage.write(path, `${JSON.stringify(next, null, 2)}\n`, {
        expectedHash: currentSnapshot.hash,
      });
      return next;
    } catch (error) {
      if (!(error instanceof StorageConflictError)) throw error;
    }
  }

  throw new Error('Research answer provenance changed repeatedly. Try rebuilding it again.');
}

/** Associates a later manual rebuild with the newest run in the active stable thread. */
export async function recordActiveResearchSynthesisOutcome(
  storage: StorageAdapter,
  topicSlug: string,
  outcome: 'proposed' | 'written',
  now = new Date(),
  artifactPath?: string,
): Promise<ResearchFile | null> {
  const research = await readResearchFile(storage, topicSlug, now);
  if (!research?.activeThreadId) return research;
  const run = [...(research.runs ?? [])]
    .reverse()
    .find((candidate) => candidate.threadId === research.activeThreadId);
  if (!run) return research;
  return recordResearchSynthesisOutcome(storage, topicSlug, run.at, outcome, now, artifactPath);
}

/** Synchronizes a resolved Synthesis.md conflict with the run that created that proposal. */
export async function resolveResearchSynthesisProposal(
  storage: StorageAdapter,
  topicSlug: string,
  proposalPath: string,
  resolution: 'accepted' | 'kept',
  now = new Date(),
): Promise<ResearchFile | null> {
  const ledger = await readProposalLedger(storage, topicSlug);
  const proposal = ledger.proposals.find((entry) => entry.proposalPath === proposalPath);
  if (!proposal || proposal.currentPath !== `${topicRoot(topicSlug)}/Synthesis.md`) return null;
  const research = await readResearchFile(storage, topicSlug, now);
  if (!research) return null;
  const producingRun =
    [...(research.runs ?? [])]
      .reverse()
      .find((run) => run.at === proposal.createdAt && run.synthesisOutcome === 'proposed') ??
    [...(research.runs ?? [])].reverse().find((run) => run.synthesisOutcome === 'proposed');
  if (!producingRun) return research;

  const next = await recordResearchSynthesisOutcome(
    storage,
    topicSlug,
    producingRun.at,
    resolution === 'accepted' ? 'written' : 'kept',
    now,
    resolution === 'accepted' ? `${topicRoot(topicSlug)}/Synthesis.md` : proposalPath,
  );
  if (resolution === 'accepted') await clearSynthesisStale(storage, topicSlug, now);
  return next;
}

/** How long a mission may sit before an armed topic re-scans itself on open. */
export const staleMissionDays = 7;

export async function setAutoRefresh(
  storage: StorageAdapter,
  topicSlug: string,
  enabled: boolean,
  now = new Date(),
): Promise<ResearchFile> {
  const normalizedSlug = topicRoot(topicSlug).slice('Topics/'.length);
  const path = researchFilePath(topicSlug);
  await readMachineFile(storage, `${topicRoot(topicSlug)}/state.json`, TopicStateSchema, now);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const currentSnapshot = await storage.read(path);
    const current = currentSnapshot
      ? await readMachineFile(storage, path, ResearchFileSchema, now)
      : ResearchFileSchema.parse({ dismissed: [], schemaVersion, topicSlug: normalizedSlug });
    const next = ResearchFileSchema.parse({ ...current, autoRefresh: enabled });
    try {
      await storage.write(path, `${JSON.stringify(next, null, 2)}\n`, {
        expectedHash: currentSnapshot?.hash ?? null,
      });
      return next;
    } catch (error) {
      if (!(error instanceof StorageConflictError)) throw error;
    }
  }

  throw new Error('Research settings changed repeatedly. Try the refresh setting again.');
}

/** Stores the shape of the next synthesis without changing evidence or run history. */
export async function setResearchOutputStyle(
  storage: StorageAdapter,
  topicSlug: string,
  outputStyle: ResearchOutputStyle,
  now = new Date(),
): Promise<ResearchFile> {
  const normalizedSlug = topicRoot(topicSlug).slice('Topics/'.length);
  const path = researchFilePath(topicSlug);
  await readMachineFile(storage, `${topicRoot(topicSlug)}/state.json`, TopicStateSchema, now);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const currentSnapshot = await storage.read(path);
    const current = currentSnapshot
      ? await readMachineFile(storage, path, ResearchFileSchema, now)
      : ResearchFileSchema.parse({ dismissed: [], schemaVersion, topicSlug: normalizedSlug });
    if (current.outputStyle === outputStyle) return current;
    const next = ResearchFileSchema.parse({ ...current, outputStyle });
    try {
      await storage.write(path, `${JSON.stringify(next, null, 2)}\n`, {
        expectedHash: currentSnapshot?.hash ?? null,
      });
      return next;
    } catch (error) {
      if (!(error instanceof StorageConflictError)) throw error;
    }
  }

  throw new Error('Research output settings changed repeatedly. Choose the format again.');
}

/**
 * Whether opening Dusori should re-scan this topic. A topic that was never scanned is not
 * stale — it has nothing to refresh — so the first run always stays an explicit choice.
 */
export function isMissionStale(
  file: ResearchFile | null,
  now = new Date(),
  staleDays = staleMissionDays,
): boolean {
  if (!file?.autoRefresh || !file.lastRunAt) return false;
  const last = new Date(file.lastRunAt).getTime();
  if (Number.isNaN(last)) return false;
  return now.getTime() - last >= staleDays * 24 * 60 * 60 * 1000;
}

export async function readSeenKeys(
  storage: StorageAdapter,
  topicSlug: string,
  now = new Date(),
): Promise<Set<string>> {
  const file = await readResearchFile(storage, topicSlug, now);
  return new Set((file?.seen ?? []).map((entry) => entry.key));
}
