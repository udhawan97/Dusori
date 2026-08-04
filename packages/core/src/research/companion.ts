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

const ArxivResponseSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      publishedAt: z.string().optional(),
      summary: z.string(),
      title: z.string(),
      url: z.url(),
    }),
  ),
});

const YouTubeResponseSchema = z.object({
  results: z.array(
    z.object({
      author: z.string(),
      id: z.string(),
      lengthSeconds: z.number(),
      publishedAt: z.string().optional(),
      summary: z.string(),
      title: z.string(),
      url: z.url(),
      viewCount: z.number(),
    }),
  ),
});

const RedditResponseSchema = z.object({
  results: z.array(
    z.object({
      comments: z.number(),
      id: z.string(),
      publishedAt: z.string().optional(),
      score: z.number(),
      subreddit: z.string(),
      summary: z.string(),
      title: z.string(),
      url: z.url(),
    }),
  ),
});

const WebSearchResponseSchema = z.object({
  results: z.array(
    z.object({
      publishedAt: z.string().optional(),
      summary: z.string(),
      title: z.string(),
      url: z.url(),
    }),
  ),
});

const FailureSchema = z.object({ error: z.string().optional(), reason: z.string().optional() });

const ResearchCapabilitiesSchema = z.object({
  providers: z.array(
    z.object({
      available: z.boolean(),
      id: z.string(),
      mode: z.string().optional(),
      reason: z.string().optional(),
    }),
  ),
});

export type ResearchCapability = z.infer<typeof ResearchCapabilitiesSchema>['providers'][number];

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
  capabilities(): Promise<ResearchCapability[]>;
  fetchPage(url: string): Promise<FetchedPage>;
  searchMsLearnRanked(query: ResearchQuery): Promise<ResearchCandidate[]>;
  searchArxiv(query: ResearchQuery): Promise<ResearchCandidate[]>;
  searchReddit(query: ResearchQuery): Promise<ResearchCandidate[]>;
  searchWeb(query: ResearchQuery): Promise<ResearchCandidate[]>;
  searchYouTube(query: ResearchQuery): Promise<ResearchCandidate[]>;
  /** Image bytes through the companion, so the browser never calls a Google host. */
  fetchYouTubeThumbnail(videoId: string): Promise<Blob>;
}

export interface CompanionClientOptions {
  baseUrl: string;
  /** Omit for the same-origin HttpOnly session established by the bundled companion app. */
  token?: string;
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
  const authorization: Record<string, string> = options.token
    ? { Authorization: `Bearer ${options.token}` }
    : {};
  const session: Pick<RequestInit, 'credentials' | 'headers'> = {
    credentials: 'same-origin',
    headers: authorization,
  };

  async function failureFrom(response: Response): Promise<CompanionFetchError> {
    const body: unknown = await response.json().catch(() => null);
    const parsed = FailureSchema.safeParse(body);
    return new CompanionFetchError(
      parsed.success && parsed.data.error ? parsed.data.error : fallbackFetchError,
      parsed.success && parsed.data.reason ? parsed.data.reason : 'fetch-failed',
    );
  }

  return {
    async capabilities() {
      const response = await fetchImpl(`${base}/api/research/capabilities`, {
        ...session,
      }).catch(() => null);
      if (!response?.ok) return [];
      const parsed = ResearchCapabilitiesSchema.safeParse(await response.json().catch(() => null));
      return parsed.success ? parsed.data.providers : [];
    },

    async fetchPage(url) {
      const response = await fetchImpl(`${base}/api/research/fetch`, {
        credentials: session.credentials,
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
      const url = `${base}/api/research/mslearn-search?q=${encodeURIComponent(query.searchText)}`;
      const response = await fetchImpl(url, session).catch(() => null);
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
        kind: 'course' as const,
        meta: {},
        provider: 'mslearn' as const,
        score: all.length - index,
        snippet: result.summary,
        title: result.title,
        url: result.url,
      }));
    },

    async searchArxiv(query) {
      const parsed = ArxivResponseSchema.safeParse(
        await readJson(
          `${base}/api/research/arxiv?q=${encodeURIComponent(query.searchText)}`,
          'arXiv search could not be reached through the companion.',
        ),
      );
      if (!parsed.success) {
        throw new CompanionFetchError(
          'The companion returned an unfamiliar arXiv format.',
          'fetch-failed',
        );
      }
      return parsed.data.results.map((result, index, all) => {
        const meta: Record<string, string> = {};
        if (result.publishedAt) meta.published = result.publishedAt.slice(0, 10);
        return {
          key: `arxiv:${result.id}`,
          kind: 'paper' as const,
          meta,
          provider: 'arxiv',
          ...(result.publishedAt === undefined ? {} : { publishedAt: result.publishedAt }),
          score: all.length - index,
          snippet: result.summary,
          title: result.title,
          url: result.url,
        };
      });
    },

    async searchReddit(query) {
      const parsed = RedditResponseSchema.safeParse(
        await readJson(
          `${base}/api/research/reddit?q=${encodeURIComponent(query.searchText)}`,
          'Reddit search could not be reached through the companion.',
        ),
      );
      if (!parsed.success) {
        throw new CompanionFetchError(
          'The companion returned an unfamiliar Reddit format.',
          'fetch-failed',
        );
      }
      return parsed.data.results.map((result, index, all) => ({
        communityScore: result.score,
        key: `reddit:${result.id}`,
        kind: 'qa' as const,
        meta: {
          comments: String(result.comments),
          community: `${formatCount(result.score)} points`,
          subreddit: `r/${result.subreddit}`,
          ...(result.publishedAt ? { published: result.publishedAt } : {}),
        },
        provider: 'reddit',
        ...(result.publishedAt === undefined ? {} : { publishedAt: result.publishedAt }),
        score: all.length - index,
        snippet: result.summary,
        title: result.title,
        url: result.url,
      }));
    },

    async searchYouTube(query) {
      const parsed = YouTubeResponseSchema.safeParse(
        await readJson(
          `${base}/api/research/youtube?q=${encodeURIComponent(query.searchText)}`,
          'YouTube search could not be reached through the companion.',
        ),
      );
      if (!parsed.success) {
        throw new CompanionFetchError(
          'The companion returned an unfamiliar YouTube format.',
          'fetch-failed',
        );
      }
      return parsed.data.results.map((result, index, all) => ({
        communityScore: result.viewCount,
        key: `youtube:${result.id}`,
        kind: 'video' as const,
        meta: {
          channel: result.author,
          // The ranker's own words for this signal: views, not "community points".
          community: `${formatCount(result.viewCount)} views`,
          duration: formatDuration(result.lengthSeconds),
          thumbnail: result.id,
          views: formatCount(result.viewCount),
          ...(result.publishedAt ? { published: result.publishedAt } : {}),
        },
        provider: 'youtube',
        ...(result.publishedAt === undefined ? {} : { publishedAt: result.publishedAt }),
        score: all.length - index,
        snippet: result.summary,
        title: result.title,
        url: result.url,
      }));
    },

    async fetchYouTubeThumbnail(videoId) {
      const response = await fetchImpl(
        `${base}/api/research/youtube-thumbnail?id=${encodeURIComponent(videoId)}`,
        session,
      ).catch(() => null);
      if (!response?.ok) {
        throw new CompanionFetchError('That thumbnail could not be loaded.', 'fetch-failed');
      }
      const blob = await response.blob();
      if (!blob.type.startsWith('image/')) {
        throw new CompanionFetchError('That thumbnail was not an image.', 'unsupported-type');
      }
      return blob;
    },

    async searchWeb(query) {
      const parsed = WebSearchResponseSchema.safeParse(
        await readJson(
          `${base}/api/research/web-search?q=${encodeURIComponent(query.searchText)}`,
          'Web search could not be reached through the companion.',
        ),
      );
      if (!parsed.success) {
        throw new CompanionFetchError(
          'The companion returned an unfamiliar web search format.',
          'fetch-failed',
        );
      }
      return parsed.data.results.map((result, index, all) => {
        const meta: Record<string, string> = { host: hostOf(result.url) };
        if (result.publishedAt) meta.published = result.publishedAt.slice(0, 10);
        return {
          key: `websearch:${result.url}`,
          kind: 'article' as const,
          meta,
          provider: 'websearch',
          ...(result.publishedAt === undefined ? {} : { publishedAt: result.publishedAt }),
          score: all.length - index,
          snippet: result.summary,
          title: result.title,
          url: result.url,
        };
      });
    },
  };

  async function readJson(url: string, fallbackMessage: string): Promise<unknown> {
    const response = await fetchImpl(url, session).catch(() => null);
    if (!response) throw new CompanionFetchError(fallbackMessage, 'fetch-failed');
    // A configuration problem (no search key set) is a different conversation from an
    // outage, so the reason the companion gives is carried through rather than flattened.
    if (!response.ok) throw await failureFrom(response);
    return response.json().catch(() => null);
  }
}

/** Compact view counts the way a viewer reads them: 1.2M rather than 1200000. */
export function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return String(Math.max(0, Math.trunc(value)));
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.trunc(seconds));
  const minutes = Math.floor(total / 60);
  const rest = String(total % 60).padStart(2, '0');
  if (minutes < 60) return `${minutes}:${rest}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${rest}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./u, '');
  } catch {
    return '';
  }
}
