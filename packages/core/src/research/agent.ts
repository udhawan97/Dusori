import type { StorageAdapter } from '../adapters.js';
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

function dedupeRankedCandidates(candidates: RankedCandidate[]): RankedCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = canonicalUrl(candidate.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} took too long to answer and was skipped.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    // A slow provider's promise keeps running; only the timer has to be released so a run
    // never holds the process open past its own result.
    if (timer) clearTimeout(timer);
  }
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
      withTimeout(provider.search(input.query, fetchImpl), timeoutMs, provider.label),
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

  // The run itself is evidence: a failure trail must survive reload exactly like a success,
  // or "no research found" and "research broke" become indistinguishable after a reload.
  // A trail that cannot be written must not cost the user the results themselves.
  const run = await recordResearchRun(
    input.storage,
    input.topicSlug,
    {
      angleId: input.query.angleId,
      candidates: ranked.map((candidate) => ({ key: candidate.key, url: candidate.url })),
      providers: outcomes,
      searchText: input.query.searchText,
    },
    now,
  )
    .then((file): ResearchRunRecord | null => file.runs?.at(-1) ?? null)
    .catch((): null => null);

  return { overflow, run, shortlist, skipped };
}
