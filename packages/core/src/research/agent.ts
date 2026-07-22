import type { StorageAdapter } from '../adapters.js';
import { rankCandidates, selectDiverse, type RankedCandidate } from './rank.js';
import { readResearchFile, recordResearchRun } from './research-file.js';
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
  settled.forEach((result, index) => {
    const provider = input.providers[index];
    if (!provider) return;
    if (result.status === 'fulfilled') {
      found.push(...result.value);
      return;
    }
    skipped.push({
      id: provider.id,
      label: provider.label,
      message: skipMessage(result.reason, provider.label),
    });
  });

  const fresh = await filterResearchSuggestions(input.storage, input.topicSlug, found, now);
  const ranked = rankCandidates(input.query, fresh, { now, seen });
  const { overflow, shortlist } = selectDiverse(ranked, input.limit);

  if (ranked.length > 0) {
    await recordResearchRun(
      input.storage,
      input.topicSlug,
      ranked.map((candidate) => ({ key: candidate.key, url: candidate.url })),
      now,
    );
  }

  return { overflow, shortlist, skipped };
}
