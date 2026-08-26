import type { StorageAdapter } from '../adapters.js';
import { withAbortingFetchTimeout } from './fetch-timeout.js';
import { rankCandidates, selectDiverse, type RankedCandidate } from './rank.js';
import {
  canonicalUrl,
  readResearchFile,
  recordResearchRun,
  type ResearchRunRecord,
  type RunProviderOutcome,
} from './research-file.js';
import { filterResearchSuggestions } from './suggest.js';
import type { ResearchCandidate, ResearchProvider, ResearchQuery } from './types.js';

export interface SkippedProvider {
  id: string;
  label: string;
  message: string;
}

export interface ResearchRunResult {
  /** Ranked, topic-relevant results retained across the shortlist and overflow. */
  eligibleCount: number;
  shortlist: RankedCandidate[];
  overflow: RankedCandidate[];
  skipped: SkippedProvider[];
  /** The run as it was persisted, or null if only the persistence step failed. */
  run: ResearchRunRecord | null;
}

export interface RunResearchAgentInput {
  storage: StorageAdapter;
  topicSlug: string;
  /** Only the providers the user has already consented to; the agent never asks. */
  providers: ResearchProvider[];
  query: ResearchQuery;
  fetchImpl?: typeof fetch;
  now?: Date;
  timeoutMs?: number;
  limit?: number;
}

const defaultTimeoutMs = 12_000;

function doiKey(candidate: RankedCandidate): string | null {
  const fromMeta = candidate.meta.doi;
  if (fromMeta && /^10\.\d{4,9}\/\S+$/iu.test(fromMeta)) return fromMeta.toLowerCase();
  try {
    const url = new URL(candidate.url);
    if (url.hostname.toLowerCase() !== 'doi.org') return null;
    const doi = decodeURIComponent(url.pathname.replace(/^\//u, ''));
    return /^10\.\d{4,9}\/\S+$/iu.test(doi) ? doi.toLowerCase() : null;
  } catch {
    return null;
  }
}

function scholarlyTitleKey(candidate: RankedCandidate): string | null {
  if (candidate.kind !== 'paper') return null;
  const normalized = candidate.title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
  return normalized.length >= 24 && normalized.split(/\s+/u).length >= 4 ? normalized : null;
}

interface CandidateGroup {
  candidate: RankedCandidate;
  dois: Set<string>;
  titles: Set<string>;
  urls: Set<string>;
}

function returnedEvidenceQuality(candidate: RankedCandidate): number {
  // An abstract already returned by the search is safer and more useful than a reference whose
  // later capture may fail or discover that no abstract exists. A snippet is still preferable to
  // an empty citation; rank remains the tie-breaker because candidates arrive strongest-first.
  if (candidate.meta._abstract?.trim()) return 2;
  return candidate.snippet.trim() ? 1 : 0;
}

function overlaps(left: Set<string>, right: Set<string>): boolean {
  return [...left].some((value) => right.has(value));
}

function dedupeRankedCandidates(candidates: RankedCandidate[]): RankedCandidate[] {
  let groups: CandidateGroup[] = [];
  for (const candidate of candidates) {
    const doi = doiKey(candidate);
    const title = scholarlyTitleKey(candidate);
    const candidateGroup: CandidateGroup = {
      candidate,
      dois: new Set(doi ? [doi] : []),
      titles: new Set(title ? [title] : []),
      urls: new Set([canonicalUrl(candidate.url)]),
    };
    const matches = groups.filter(
      (group) =>
        overlaps(group.urls, candidateGroup.urls) ||
        overlaps(group.dois, candidateGroup.dois) ||
        overlaps(group.titles, candidateGroup.titles),
    );
    if (matches.length === 0) {
      groups.push(candidateGroup);
      continue;
    }

    const primary = matches[0]!;
    for (const group of [candidateGroup, ...matches.slice(1)]) {
      for (const value of group.urls) primary.urls.add(value);
      for (const value of group.dois) primary.dois.add(value);
      for (const value of group.titles) primary.titles.add(value);
      if (returnedEvidenceQuality(group.candidate) > returnedEvidenceQuality(primary.candidate)) {
        primary.candidate = group.candidate;
      }
    }
    if (matches.length > 1) {
      groups = groups.filter((group) => group === primary || !matches.includes(group));
    }
  }
  return groups.map((group) => group.candidate);
}

function skipMessage(error: unknown, label: string): string {
  if (error instanceof Error && error.message) return error.message;
  return `${label} could not be reached and was skipped.`;
}

/**
 * One run of the research agent: ask every consented provider at once, keep whatever comes back,
 * and rank it. A provider that fails or stalls is reported as skipped rather than failing the
 * run — a slow API must never cost the user the results the others returned.
 */
export async function runResearchAgent(input: RunResearchAgentInput): Promise<ResearchRunResult> {
  const now = input.now ?? new Date();
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? defaultTimeoutMs;

  // "New" means new since the last run, so it stays undefined until there has been one.
  // Badging every result on a first run would mark everything and mean nothing.
  const previous = await readResearchFile(input.storage, input.topicSlug, now);
  const seen = previous?.lastRunAt
    ? new Set((previous.seen ?? []).map((item) => item.key))
    : undefined;

  const settled = await Promise.allSettled(
    input.providers.map(async (provider) =>
      withAbortingFetchTimeout(
        fetchImpl,
        timeoutMs,
        `${provider.label} took too long to answer and was skipped.`,
        (scopedFetch) => provider.search(input.query, scopedFetch),
      ),
    ),
  );

  const found: ResearchCandidate[] = [];
  const skipped: SkippedProvider[] = [];
  const outcomes: RunProviderOutcome[] = [];
  settled.forEach((result, index) => {
    const provider = input.providers[index];
    if (!provider) return;
    if (result.status === 'fulfilled') {
      found.push(...result.value);
      outcomes.push({
        count: result.value.length,
        id: provider.id,
        label: provider.label,
        outcome: result.value.length > 0 ? 'found' : 'empty',
      });
      return;
    }
    const message = skipMessage(result.reason, provider.label);
    skipped.push({ id: provider.id, label: provider.label, message });
    outcomes.push({ count: 0, id: provider.id, label: provider.label, message, outcome: 'failed' });
  });

  const fresh = await filterResearchSuggestions(input.storage, input.topicSlug, found, now);
  const ranked = dedupeRankedCandidates(rankCandidates(input.query, fresh, { now, seen }));
  const { overflow, shortlist } = selectDiverse(ranked, input.limit);
  const eligible = [...shortlist, ...overflow];

  // The run itself is evidence: a failure trail must survive reload exactly like a success,
  // or "no research found" and "research broke" become indistinguishable after a reload.
  // A trail that cannot be written must not cost the user the results themselves.
  const run = await recordResearchRun(
    input.storage,
    input.topicSlug,
    {
      angleId: input.query.angleId,
      candidates: eligible.map((candidate) => ({ key: candidate.key, url: candidate.url })),
      eligibleCount: eligible.length,
      providers: outcomes,
      searchText: input.query.searchText,
    },
    now,
  )
    .then((file): ResearchRunRecord | null => file.runs?.at(-1) ?? null)
    .catch((): null => null);

  return { eligibleCount: eligible.length, overflow, run, shortlist, skipped };
}
