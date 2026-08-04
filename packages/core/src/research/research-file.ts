import { z } from 'zod';

import { StorageConflictError, type StorageAdapter } from '../adapters.js';
import { readMachineFile } from '../schemas/read-machine-file.js';
import { TopicStateSchema, schemaVersion } from '../schemas/workspace.js';
import { topicRoot } from '../workspace/paths.js';

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
    angleId: z.string().min(1).max(40).optional(),
    providers: z.array(RunProviderOutcomeSchema).max(24),
    newKeys: z.number().int().nonnegative(),
  })
  .passthrough();

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
  })
  .passthrough();

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
    return new URL(url).toString();
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
  angleId?: string;
  providers: RunProviderOutcome[];
  /** Ranked candidates that survived dedupe; empty on a failed or genuinely empty run. */
  candidates: { key: string; url?: string }[];
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

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const currentSnapshot = await storage.read(path);
    const current = currentSnapshot
      ? await readMachineFile(storage, path, ResearchFileSchema, now)
      : ResearchFileSchema.parse({ dismissed: [], schemaVersion, topicSlug: normalizedSlug });
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
      newKeys,
      providers: run.providers,
      searchText: run.searchText,
    });
    const next = ResearchFileSchema.parse({
      ...current,
      lastRunAt: at,
      runs: [...(current.runs ?? []), record].slice(-maxRunEntries),
      seen: [...merged.values()]
        .sort((left, right) => left.at.localeCompare(right.at))
        .slice(-maxSeenEntries),
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
