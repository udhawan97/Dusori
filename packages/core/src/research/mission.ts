import type { StorageAdapter } from '../adapters.js';
import type { SourceRecord } from '../schemas/workspace.js';
import { readSourceManifest } from '../sources/import.js';
import { readResearchFile, type ResearchRunRecord } from './research-file.js';
import { researchProviderPolicy, type ResearchProviderLens } from './providers/catalog.js';

export type MissionLens = ResearchProviderLens;

export const missionLenses: readonly MissionLens[] = [
  'docs',
  'academic',
  'books',
  'community',
  'video',
  'web',
];

export const missionLensLabels: Record<MissionLens, string> = {
  academic: 'Academic',
  books: 'Books',
  community: 'Community',
  docs: 'Docs',
  video: 'Video',
  web: 'Web',
};

export function lensFor(providerId: string): MissionLens {
  return researchProviderPolicy.lensFor(providerId);
}

export interface MissionOverview {
  topicSlug: string;
  /** Sources saved into the topic manifest. */
  savedSources: number;
  /** Sources whose text is on this device and has been read into claims. */
  readSources: number;
  /** Candidates this topic's runs have ever surfaced, from the bounded seen history. */
  discovered: number;
  lastRunAt: string | null;
  lastRun: ResearchRunRecord | null;
  runCount: number;
  lensCounts: Record<MissionLens, number>;
  /** Claims extracted across every read source, the evidence synthesis draws on. */
  claimCount: number;
}

function emptyLensCounts(): Record<MissionLens, number> {
  return { academic: 0, books: 0, community: 0, docs: 0, video: 0, web: 0 };
}

/** A source counts as read once its local text produced claims. */
export function isReadSource(source: SourceRecord): boolean {
  return source.readState === 'read' && (source.claims?.length ?? 0) > 0;
}

/**
 * Mission status is always derived from current evidence, never stored, so it can go stale
 * or lie only if the workspace files themselves do.
 */
export async function deriveMissionOverview(
  storage: StorageAdapter,
  topicSlug: string,
  now = new Date(),
): Promise<MissionOverview> {
  const lensCounts = emptyLensCounts();
  let savedSources = 0;
  let readSources = 0;
  let claimCount = 0;
  try {
    const manifest = await readSourceManifest(storage, topicSlug, now);
    savedSources = manifest.sources.length;
    for (const source of manifest.sources) {
      if (source.origin) lensCounts[lensFor(source.origin.provider)] += 1;
      if (isReadSource(source)) readSources += 1;
      claimCount += source.claims?.length ?? 0;
    }
  } catch {
    // A missing or invalid manifest is already a Needs attention condition; the mission
    // reports zero rather than failing the whole Today view.
  }
  const research = await readResearchFile(storage, topicSlug, now).catch(() => null);
  return {
    claimCount,
    discovered: research?.seen?.length ?? 0,
    lastRun: research?.runs?.at(-1) ?? null,
    lastRunAt: research?.lastRunAt ?? null,
    lensCounts,
    readSources,
    runCount: research?.runs?.length ?? 0,
    savedSources,
    topicSlug,
  };
}

/** Days since the last run, or null when this topic has never been scanned. */
export function missionAgeInDays(mission: MissionOverview, now = new Date()): number | null {
  if (!mission.lastRunAt) return null;
  const last = new Date(mission.lastRunAt).getTime();
  if (Number.isNaN(last)) return null;
  return Math.floor((now.getTime() - last) / (24 * 60 * 60 * 1000));
}

/** Providers that failed on the most recent run, so a strip can say so plainly. */
export function failedProvidersOnLastRun(mission: MissionOverview): string[] {
  return (mission.lastRun?.providers ?? [])
    .filter((provider) => provider.outcome === 'failed')
    .map((provider) => provider.label);
}
