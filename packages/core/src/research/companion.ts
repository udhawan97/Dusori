import { z } from 'zod';

import type { ResearchCandidate, ResearchQuery } from './types.js';

const FetchedPageSchema = z.object({
  byline: z.string().optional(),
  fetchedAt: z.string().datetime(),
  finalUrl: z.url(),
  siteName: z.string().optional(),
  text: z.string().min(1),
  title: z.string().min(1),
  truncated: z.boolean(),
});

export type FetchedPage = z.infer<typeof FetchedPageSchema>;

const RankedResponseSchema = z.object({
  results: z.array(z.object({ summary: z.string(), title: z.string(), url: z.url() })),
});

const FailureSchema = z.object({ error: z.string().optional(), reason: z.string().optional() });

export class CompanionFetchError extends Error {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = 'CompanionFetchError';
  }
}

export interface CompanionResearchClient {
  fetchPage(url: string): Promise<FetchedPage>;
  searchMsLearnRanked(query: ResearchQuery): Promise<ResearchCandidate[]>;
}

export interface CompanionClientOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}

const fallbackFetchError =
  'The companion could not fetch this page. Check that it is still running.';
const fallbackSearchError = 'Microsoft Learn ranked search could not be reached.';

export function createCompanionResearchClient(
  options: CompanionClientOptions,
): CompanionResearchClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.baseUrl.replace(/\/+$/u, '');
  const authorization = { Authorization: `Bearer ${options.token}` };

  async function failureFrom(response: Response): Promise<CompanionFetchError> {
    const body: unknown = await response.json().catch(() => null);
    const parsed = FailureSchema.safeParse(body);
    return new CompanionFetchError(
      parsed.success && parsed.data.error ? parsed.data.error : fallbackFetchError,
      parsed.success && parsed.data.reason ? parsed.data.reason : 'fetch-failed',
    );
  }

  return {
    async fetchPage(url) {
      const response = await fetchImpl(`${base}/api/research/fetch`, {
        body: JSON.stringify({ url }),
        headers: { ...authorization, 'Content-Type': 'application/json' },
        method: 'POST',
      }).catch(() => null);
      if (!response) throw new CompanionFetchError(fallbackFetchError, 'fetch-failed');
      if (!response.ok) throw await failureFrom(response);

      const body: unknown = await response.json().catch(() => null);
      const parsed = FetchedPageSchema.safeParse(body);
      if (!parsed.success) {
        throw new CompanionFetchError(
          'The companion returned an unfamiliar fetch format.',
          'fetch-failed',
        );
      }
      return parsed.data;
    },

    async searchMsLearnRanked(query) {
      const url = `${base}/api/research/mslearn-search?q=${encodeURIComponent(query.objectiveTitle)}`;
      const response = await fetchImpl(url, { headers: authorization }).catch(() => null);
      if (!response?.ok) throw new CompanionFetchError(fallbackSearchError, 'fetch-failed');

      const body: unknown = await response.json().catch(() => null);
      const parsed = RankedResponseSchema.safeParse(body);
      if (!parsed.success) {
        throw new CompanionFetchError(
          'The companion returned an unfamiliar search format.',
          'fetch-failed',
        );
      }

      return parsed.data.results.map((result, index, all) => ({
        key: `mslearn:${result.url}`,
        meta: {},
        provider: 'mslearn' as const,
        score: all.length - index,
        snippet: result.summary,
        title: result.title,
        url: result.url,
      }));
    },
  };
}
