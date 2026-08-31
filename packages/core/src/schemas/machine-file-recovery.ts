import { z } from 'zod';

import { type StorageAdapter, StorageConflictError } from '../adapters.js';
import { ProposalLedgerSchema } from '../conflict/proposal-ledger.js';
import { ReviewScheduleSchema } from '../learning/review.js';
import {
  DismissedResearchSuggestionSchema,
  ResearchFileSchema,
  ResearchOutputStyleSchema,
  ResearchRunRecordSchema,
  SeenResearchCandidateSchema,
} from '../research/research-file.js';
import {
  ResearchThreadEventSchema,
  ResearchThreadEventTombstoneSchema,
  ResearchThreadIdSchema,
  ResearchThreadSchema,
  ResearchThreadTombstoneSchema,
  boundResearchThreadActivity,
  maxResearchThreadTombstones,
} from '../research/thread-events.js';
import {
  FileVersionSchema,
  RemovedSourceSchema,
  SourceManifestSchema,
  SourceRecordSchema,
  TopicIndexSchema,
  TopicStateSchema,
  WorkspaceSchema,
  schemaVersion,
} from './workspace.js';
import { safeTimestamp } from '../workspace/paths.js';

export type MachineFileKind =
  | 'proposal-ledger'
  | 'research-activity'
  | 'review-schedule'
  | 'source-manifest'
  | 'topic-state'
  | 'workspace-index';

export interface MachineFileRecoveryPlan {
  expectedHash: string;
  issue: string;
  kind: MachineFileKind;
  label: string;
  originalBytes: number;
  originalExcerpt: string;
  originalTruncated: boolean;
  path: string;
  proposedContent?: string;
  repairSummary: string;
  topicSlug?: string;
}

export interface AppliedMachineFileRecovery {
  archivePath: string;
  path: string;
}

interface MachineFileDescriptor {
  kind: MachineFileKind;
  label: string;
  path: string;
  schema: z.ZodType;
  topicSlug?: string;
}

const machineFilePreviewLimit = 12_000;
const isoDate = z.string().datetime();

function descriptorForPath(path: string): MachineFileDescriptor | null {
  if (path === 'dusori.json') {
    return { kind: 'workspace-index', label: 'Workspace index', path, schema: WorkspaceSchema };
  }

  const match =
    /^Topics\/([^/]+)\/(state|research|review|proposals|Sources\/manifest)\.json$/u.exec(path);
  if (!match?.[1] || !match[2]) return null;
  const topicSlug = match[1];
  const byName: Record<string, Pick<MachineFileDescriptor, 'kind' | 'label' | 'schema'>> = {
    proposals: {
      kind: 'proposal-ledger',
      label: 'Proposal ledger',
      schema: ProposalLedgerSchema,
    },
    research: {
      kind: 'research-activity',
      label: 'Research activity',
      schema: ResearchFileSchema,
    },
    review: {
      kind: 'review-schedule',
      label: 'Review schedule',
      schema: ReviewScheduleSchema,
    },
    'Sources/manifest': {
      kind: 'source-manifest',
      label: 'Source manifest',
      schema: SourceManifestSchema,
    },
    state: { kind: 'topic-state', label: 'Topic state', schema: TopicStateSchema },
  };
  const descriptor = byName[match[2]];
  return descriptor ? { ...descriptor, path, topicSlug } : null;
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function withoutKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

function validItems<T>(value: unknown, schema: z.ZodType<T>): T[] {
  return (Array.isArray(value) ? value : []).flatMap((item) => {
    const result = schema.safeParse(item);
    return result.success ? [result.data] : [];
  });
}

function parseJson(content: string): { data?: unknown; issue?: string } {
  try {
    return { data: JSON.parse(content) as unknown };
  } catch {
    return { issue: 'The file is not valid JSON.' };
  }
}

function validationIssue(
  descriptor: MachineFileDescriptor,
  content: string,
): { data?: unknown; issue?: string } {
  const parsed = parseJson(content);
  if (parsed.issue) return parsed;
  const result = descriptor.schema.safeParse(parsed.data);
  if (!result.success) {
    const first = result.error.issues[0];
    const location = first?.path.length ? ` at ${first.path.join('.')}` : '';
    return {
      data: parsed.data,
      issue: `${first?.message ?? 'The stored shape is invalid'}${location}.`,
    };
  }
  if (
    descriptor.topicSlug &&
    'topicSlug' in objectValue(result.data) &&
    objectValue(result.data).topicSlug !== descriptor.topicSlug
  ) {
    return {
      data: parsed.data,
      issue: `The file names topic “${String(objectValue(result.data).topicSlug)}” instead of “${descriptor.topicSlug}”.`,
    };
  }
  return { data: result.data };
}

function pretty(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function validFileIndex(value: unknown): Record<string, z.infer<typeof FileVersionSchema>> {
  const entries = Object.entries(objectValue(value)).flatMap(([path, version]) => {
    const result = FileVersionSchema.safeParse(version);
    return result.success ? [[path, result.data] as const] : [];
  });
  return Object.fromEntries(entries);
}

async function derivedFileIndex(
  storage: StorageAdapter,
  prefix: string,
): Promise<Record<string, z.infer<typeof FileVersionSchema>>> {
  const entries = await storage.list(prefix, true);
  const index: Record<string, z.infer<typeof FileVersionSchema>> = {};
  for (const entry of entries) {
    if (
      entry.kind !== 'file' ||
      descriptorForPath(entry.path) ||
      entry.path.includes('/.dusori-')
    ) {
      continue;
    }
    const snapshot = await storage.read(entry.path);
    if (snapshot) index[entry.path] = { hash: snapshot.hash, modifiedAt: snapshot.modifiedAt };
  }
  return index;
}

function titleFromSlug(slug: string): string {
  const title = slug
    .split('-')
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ')
    .slice(0, 160);
  return title || 'Recovered topic';
}

async function topicTitle(storage: StorageAdapter, slug: string): Promise<string> {
  const overview = await storage.read(`Topics/${slug}/Overview.md`);
  const heading = /^#\s+(.+)$/mu.exec(overview?.content ?? '')?.[1]?.trim();
  return heading && heading.length <= 160 ? heading : titleFromSlug(slug);
}

async function workspaceReplacement(
  storage: StorageAdapter,
  raw: unknown,
  now: Date,
): Promise<{ content: string; summary: string }> {
  const input = objectValue(raw);
  const rawTopics = Array.isArray(input.topics)
    ? input.topics.flatMap((topic) => {
        const result = TopicIndexSchema.safeParse(topic);
        return result.success ? [result.data] : [];
      })
    : [];
  const topics = new Map(rawTopics.map((topic) => [topic.slug, topic]));
  const entries = await storage.list('Topics', true);
  for (const entry of entries) {
    const descriptor = entry.kind === 'file' ? descriptorForPath(entry.path) : null;
    if (descriptor?.kind !== 'topic-state' || !descriptor.topicSlug) continue;
    const snapshot = await storage.read(entry.path);
    if (!snapshot) continue;
    const result = TopicStateSchema.safeParse(parseJson(snapshot.content).data);
    if (!result.success || result.data.topicSlug !== descriptor.topicSlug) continue;
    topics.set(descriptor.topicSlug, {
      createdAt: result.data.createdAt,
      kind: result.data.kind,
      slug: descriptor.topicSlug,
      title:
        topics.get(descriptor.topicSlug)?.title ??
        (await topicTitle(storage, descriptor.topicSlug)),
    });
  }
  const home = await storage.read('Home.md');
  const fileIndex = validFileIndex(input.fileIndex);
  if (home) fileIndex['Home.md'] = { hash: home.hash, modifiedAt: home.modifiedAt };
  const createdAt = isoDate.safeParse(input.createdAt);
  const name =
    typeof input.name === 'string' && input.name.trim() && input.name.length <= 160
      ? input.name.trim()
      : 'Recovered research workspace';
  const replacement = WorkspaceSchema.parse({
    schemaVersion,
    name,
    createdAt: createdAt.success ? createdAt.data : now.toISOString(),
    updatedAt: now.toISOString(),
    topics: [...topics.values()].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    ),
    fileIndex,
  });
  return {
    content: pretty(replacement),
    summary: `Rebuild the workspace index from ${replacement.topics.length} valid topic ${replacement.topics.length === 1 ? 'record' : 'records'} and the current Home.md. Topic files stay in place.`,
  };
}

async function topicStateReplacement(
  storage: StorageAdapter,
  raw: unknown,
  topicSlug: string,
  now: Date,
): Promise<{ content: string; summary: string }> {
  const input = objectValue(raw);
  const workspaceSnapshot = await storage.read('dusori.json');
  const workspace = WorkspaceSchema.safeParse(parseJson(workspaceSnapshot?.content ?? '').data);
  const indexedTopic = workspace.success
    ? workspace.data.topics.find((topic) => topic.slug === topicSlug)
    : undefined;
  const createdAt = isoDate.safeParse(input.createdAt);
  const kind =
    input.kind === 'certification' || input.kind === 'general' ? input.kind : indexedTopic?.kind;
  const status = input.status === 'paused' || input.status === 'complete' ? input.status : 'active';
  const recoveredIndex = await derivedFileIndex(storage, `Topics/${topicSlug}`);
  const replacement = TopicStateSchema.parse({
    schemaVersion,
    topicSlug,
    ...(kind ? { kind } : {}),
    status,
    createdAt: createdAt.success ? createdAt.data : (indexedTopic?.createdAt ?? now.toISOString()),
    updatedAt: now.toISOString(),
    fileIndex: recoveredIndex,
  });
  return {
    content: pretty(replacement),
    summary: `Rebuild this topic as ${replacement.status} and index ${Object.keys(recoveredIndex).length} current learner-owned ${Object.keys(recoveredIndex).length === 1 ? 'file' : 'files'}.`,
  };
}

function sourceManifestReplacement(raw: unknown): { content: string; summary: string } {
  const input = objectValue(raw);
  const sourceInputs = Array.isArray(input.sources) ? input.sources : [];
  const removedInputs = Array.isArray(input.removedSources) ? input.removedSources : [];
  const sources = validItems(sourceInputs, SourceRecordSchema);
  const removedSources = validItems(removedInputs, RemovedSourceSchema);
  const staleAt = isoDate.safeParse(input.synthesisStaleAt);
  const staleReason = z.string().min(1).max(240).safeParse(input.synthesisStaleReason);
  const replacement = SourceManifestSchema.parse({
    ...withoutKeys(input, [
      'removedSources',
      'schemaVersion',
      'sources',
      'synthesisStaleAt',
      'synthesisStaleReason',
    ]),
    schemaVersion,
    sources,
    ...(removedSources.length > 0 ? { removedSources } : {}),
    ...(staleAt.success ? { synthesisStaleAt: staleAt.data } : {}),
    ...(staleReason.success ? { synthesisStaleReason: staleReason.data } : {}),
  });
  return {
    content: pretty(replacement),
    summary: `Keep ${sources.length} of ${sourceInputs.length} valid source ${sourceInputs.length === 1 ? 'record' : 'records'} and ${removedSources.length} of ${removedInputs.length} valid removed-source ${removedInputs.length === 1 ? 'record' : 'records'}. Existing source files stay on disk; omitted records remain in the archived original.`,
  };
}

function researchReplacement(
  raw: unknown,
  topicSlug: string,
): { content: string; summary: string } {
  const input = objectValue(raw);
  const threads = validItems(input.threads, ResearchThreadSchema).slice(-50);
  const retainedThreadIds = new Set(threads.map((thread) => thread.threadId));
  const inputEvents = Array.isArray(input.events) ? input.events : [];
  const validEvents = validItems(inputEvents, ResearchThreadEventSchema);
  const inputEventTombstones = Array.isArray(input.eventTombstones) ? input.eventTombstones : [];
  const validEventTombstones = validItems(inputEventTombstones, ResearchThreadEventTombstoneSchema);
  const bounded = boundResearchThreadActivity(validEvents, retainedThreadIds, validEventTombstones);
  const threadTombstones = validItems(input.threadTombstones, ResearchThreadTombstoneSchema).slice(
    -maxResearchThreadTombstones,
  );
  const dismissed = validItems(input.dismissed, DismissedResearchSuggestionSchema);
  const seen = validItems(input.seen, SeenResearchCandidateSchema);
  const runs = validItems(input.runs, ResearchRunRecordSchema);
  const lastRunAt = isoDate.safeParse(input.lastRunAt);
  const synthesisRunAt = isoDate.safeParse(input.synthesisRunAt);
  const outputStyle = ResearchOutputStyleSchema.safeParse(input.outputStyle);
  const activeThreadId = ResearchThreadIdSchema.safeParse(input.activeThreadId);
  const replacement = ResearchFileSchema.parse({
    ...withoutKeys(input, [
      'activeThreadId',
      'autoRefresh',
      'dismissed',
      'events',
      'eventTombstones',
      'lastRunAt',
      'outputStyle',
      'runs',
      'schemaVersion',
      'seen',
      'synthesisRunAt',
      'threads',
      'threadTombstones',
      'topicSlug',
    ]),
    dismissed,
    schemaVersion,
    topicSlug,
    ...(lastRunAt.success ? { lastRunAt: lastRunAt.data } : {}),
    ...(seen.length > 0 ? { seen } : {}),
    ...(runs.length > 0 ? { runs } : {}),
    ...(typeof input.autoRefresh === 'boolean' ? { autoRefresh: input.autoRefresh } : {}),
    ...(outputStyle.success ? { outputStyle: outputStyle.data } : {}),
    ...(synthesisRunAt.success ? { synthesisRunAt: synthesisRunAt.data } : {}),
    ...(threads.length > 0 ? { threads } : {}),
    ...(bounded.events.length > 0 ? { events: bounded.events } : {}),
    ...(bounded.eventTombstones.length > 0 ? { eventTombstones: bounded.eventTombstones } : {}),
    ...(threadTombstones.length > 0 ? { threadTombstones } : {}),
    ...(activeThreadId.success && retainedThreadIds.has(activeThreadId.data)
      ? { activeThreadId: activeThreadId.data }
      : {}),
  });
  return {
    content: pretty(replacement),
    summary: `Keep ${threads.length} valid ${threads.length === 1 ? 'thread' : 'threads'}, ${bounded.events.length} of ${inputEvents.length} valid activity ${inputEvents.length === 1 ? 'event' : 'events'}, and ${runs.length} valid research ${runs.length === 1 ? 'run' : 'runs'}. Saved sources, notes, and briefs stay in place; omitted records remain in the archived original.`,
  };
}

function proposalLedgerReplacement(
  raw: unknown,
  topicSlug: string,
): { content: string; summary: string } {
  const input = objectValue(raw);
  const proposalInputs = Array.isArray(input.proposals) ? input.proposals : [];
  const proposals: unknown[] = [];
  for (const proposal of proposalInputs) {
    const candidate = ProposalLedgerSchema.safeParse({
      proposals: [...proposals, proposal],
      schemaVersion,
      topicSlug,
    });
    if (candidate.success) proposals.push(candidate.data.proposals.at(-1));
  }
  const replacement = ProposalLedgerSchema.parse({ proposals, schemaVersion, topicSlug });
  return {
    content: pretty(replacement),
    summary: `Keep ${proposals.length} of ${proposalInputs.length} valid proposal ${proposalInputs.length === 1 ? 'record' : 'records'}. Existing Markdown and proposal files stay in place; omitted records remain in the archived original.`,
  };
}

function reviewScheduleReplacement(
  raw: unknown,
  topicSlug: string,
): { content?: string; summary: string } {
  const input = objectValue(raw);
  const replacement = ReviewScheduleSchema.safeParse({
    ...input,
    schemaVersion,
    topicSlug,
  });
  return replacement.success
    ? {
        content: pretty(replacement.data),
        summary:
          'Keep the recorded review dates and repetition, correcting only this file’s topic identity or schema marker.',
      }
    : {
        summary:
          'No automatic repair is offered because inventing a replacement schedule would falsely claim that a review happened. Restore this file from an export or edit the archived JSON deliberately.',
      };
}

async function proposedReplacement(
  storage: StorageAdapter,
  descriptor: MachineFileDescriptor,
  raw: unknown,
  now: Date,
): Promise<{ content?: string; summary: string }> {
  switch (descriptor.kind) {
    case 'workspace-index':
      return workspaceReplacement(storage, raw, now);
    case 'topic-state':
      return topicStateReplacement(storage, raw, descriptor.topicSlug!, now);
    case 'source-manifest':
      return sourceManifestReplacement(raw);
    case 'research-activity':
      return researchReplacement(raw, descriptor.topicSlug!);
    case 'proposal-ledger':
      return proposalLedgerReplacement(raw, descriptor.topicSlug!);
    case 'review-schedule':
      return reviewScheduleReplacement(raw, descriptor.topicSlug!);
  }
}

/** Read-only scan of every machine-owned JSON file whose contract Dusori can identify. */
export async function inspectMachineFileRecoveries(
  storage: StorageAdapter,
  now = new Date(),
): Promise<MachineFileRecoveryPlan[]> {
  const entries = await storage.list('', true);
  const paths = new Set(
    entries.filter((entry) => entry.kind === 'file').map((entry) => entry.path),
  );
  if (await storage.read('dusori.json')) paths.add('dusori.json');
  const plans: MachineFileRecoveryPlan[] = [];
  for (const path of [...paths].sort((left, right) => left.localeCompare(right))) {
    const descriptor = descriptorForPath(path);
    if (!descriptor) continue;
    const snapshot = await storage.read(path);
    if (!snapshot) continue;
    const validation = validationIssue(descriptor, snapshot.content);
    if (!validation.issue) continue;
    const proposal = await proposedReplacement(storage, descriptor, validation.data, now);
    plans.push({
      expectedHash: snapshot.hash,
      issue: validation.issue,
      kind: descriptor.kind,
      label: descriptor.label,
      originalBytes: new TextEncoder().encode(snapshot.content).byteLength,
      originalExcerpt: snapshot.content.slice(0, machineFilePreviewLimit),
      originalTruncated: snapshot.content.length > machineFilePreviewLimit,
      path,
      proposedContent: proposal.content,
      repairSummary: proposal.summary,
      topicSlug: descriptor.topicSlug,
    });
  }
  return plans;
}

/**
 * Apply only the exact proposal the learner already reviewed. The original bytes are archived before
 * the hash-guarded replacement, and a changed file fails closed instead of replaying a stale plan.
 */
export async function applyMachineFileRecovery(
  storage: StorageAdapter,
  plan: MachineFileRecoveryPlan,
  now = new Date(),
): Promise<AppliedMachineFileRecovery> {
  if (!plan.proposedContent) throw new Error('This machine file has no safe automatic repair.');
  const descriptor = descriptorForPath(plan.path);
  if (!descriptor || descriptor.kind !== plan.kind) {
    throw new Error('The recovery target is not a recognized machine-owned file.');
  }
  const current = await storage.read(plan.path);
  if (!current) throw new Error(`The machine file is missing: ${plan.path}`);
  if (current.hash !== plan.expectedHash) {
    throw new StorageConflictError(plan.path, plan.expectedHash, current.hash);
  }
  const proposedValidation = validationIssue(descriptor, plan.proposedContent);
  if (proposedValidation.issue) {
    throw new Error(`The proposed repair is no longer valid: ${proposedValidation.issue}`);
  }

  const archivePath = `.dusori-recovery/${safeTimestamp(now)}-${current.hash.slice(0, 8)}/${plan.path}`;
  await storage.write(archivePath, current.content, { expectedHash: null });
  try {
    await storage.write(plan.path, plan.proposedContent, { expectedHash: current.hash });
  } catch (error) {
    throw new Error(
      `The repair was not applied. The original is still active, and an independent copy remains at ${archivePath}.`,
      { cause: error },
    );
  }
  return { archivePath, path: plan.path };
}
