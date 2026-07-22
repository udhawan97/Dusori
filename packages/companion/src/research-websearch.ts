import { z } from 'zod';

const maxResults = 8;
const braveUpstream = 'https://api.search.brave.com/res/v1/web/search';
const tavilyUpstream = 'https://api.tavily.com/search';
const unreachableMessage = 'The configured web search provider could not be reached.';
const notConfiguredMessage =
  'Web search is not configured. Set BRAVE_API_KEY, TAVILY_API_KEY, or SEARXNG_URL ' +
  '(and optionally RESEARCH_WEB_SEARCH=brave|tavily|searxng) before launching the companion.';

export type WebSearchKind = 'brave' | 'searxng' | 'tavily';
export type WebSearchFailureReason = 'fetch-failed' | 'not-configured';
export type WebSearchEnv = Record<string, string | undefined>;

const labels: Record<WebSearchKind, string> = {
  brave: 'Brave Search',
  searxng: 'SearXNG',
  tavily: 'Tavily',
};

const BraveSchema = z.object({
  web: z.object({
    results: z.array(
      z.object({
        age: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
        title: z.string(),
        url: z.string(),
      }),
    ),
  }),
});

const TavilySchema = z.object({
  results: z.array(
    z.object({
      content: z.string().nullable().optional(),
      published_date: z.string().nullable().optional(),
      title: z.string(),
      url: z.string(),
    }),
  ),
});

const SearxngSchema = z.object({
  results: z.array(
    z.object({
      content: z.string().nullable().optional(),
      publishedDate: z.string().nullable().optional(),
      title: z.string(),
      url: z.string(),
    }),
  ),
});

export interface WebSearchResult {
  publishedAt?: string;
  summary: string;
  title: string;
  url: string;
}

export interface WebSearchOptions {
  env?: WebSearchEnv;
  fetchImpl?: typeof fetch;
}

export class WebSearchError extends Error {
  constructor(
    message: string,
    readonly reason: WebSearchFailureReason,
  ) {
    super(message);
    this.name = 'WebSearchError';
  }
}

function credential(env: WebSearchEnv, kind: WebSearchKind): string {
  const raw =
    kind === 'brave' ? env.BRAVE_API_KEY : kind === 'tavily' ? env.TAVILY_API_KEY : env.SEARXNG_URL;
  return raw?.trim() ?? '';
}

/** Reports which upstream is usable without ever revealing the credential. */
export function webSearchConfig(
  env: WebSearchEnv = process.env,
): { kind: WebSearchKind; label: string } | null {
  const selected = env.RESEARCH_WEB_SEARCH?.trim().toLowerCase();
  const configured = (['brave', 'searxng', 'tavily'] as const).filter((kind) =>
    Boolean(credential(env, kind)),
  );
  if (selected) {
    const kind = configured.find((candidate) => candidate === selected);
    return kind ? { kind, label: labels[kind] } : null;
  }
  const only = configured.length === 1 ? configured[0] : undefined;
  return only ? { kind: only, label: labels[only] } : null;
}

function collapse(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/gu, ' ').trim();
}

function toResult(raw: {
  published?: string | null;
  summary?: string | null;
  title: string;
  url: string;
}): WebSearchResult {
  const publishedAt = collapse(raw.published);
  return {
    ...(publishedAt ? { publishedAt } : {}),
    summary: collapse(raw.summary),
    title: collapse(raw.title),
    url: raw.url,
  };
}

async function request(url: string, init: RequestInit, fetchImpl: typeof fetch): Promise<unknown> {
  // Every failure is rewritten to a fixed message: the upstream error may carry
  // the request we sent, and the credential travels in a header or the body.
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch {
    throw new WebSearchError(unreachableMessage, 'fetch-failed');
  }
  if (!response.ok) throw new WebSearchError(unreachableMessage, 'fetch-failed');
  return response.json().catch(() => null);
}

export async function searchWeb(
  query: string,
  { env = process.env, fetchImpl = fetch }: WebSearchOptions = {},
): Promise<WebSearchResult[]> {
  const config = webSearchConfig(env);
  if (!config) throw new WebSearchError(notConfiguredMessage, 'not-configured');
  const key = credential(env, config.kind);

  if (config.kind === 'brave') {
    const url = new URL(braveUpstream);
    url.search = new URLSearchParams({ count: String(maxResults), q: query }).toString();
    const parsed = BraveSchema.safeParse(
      await request(
        url.toString(),
        { headers: { Accept: 'application/json', 'X-Subscription-Token': key } },
        fetchImpl,
      ),
    );
    if (!parsed.success) throw new WebSearchError(unreachableMessage, 'fetch-failed');
    return parsed.data.web.results.slice(0, maxResults).map((result) =>
      toResult({
        published: result.age,
        summary: result.description,
        title: result.title,
        url: result.url,
      }),
    );
  }

  if (config.kind === 'tavily') {
    const parsed = TavilySchema.safeParse(
      await request(
        tavilyUpstream,
        {
          body: JSON.stringify({ api_key: key, max_results: maxResults, query }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
        fetchImpl,
      ),
    );
    if (!parsed.success) throw new WebSearchError(unreachableMessage, 'fetch-failed');
    return parsed.data.results.slice(0, maxResults).map((result) =>
      toResult({
        published: result.published_date,
        summary: result.content,
        title: result.title,
        url: result.url,
      }),
    );
  }

  let url: URL;
  try {
    url = new URL(`${key.replace(/\/+$/u, '')}/search`);
  } catch {
    throw new WebSearchError(unreachableMessage, 'fetch-failed');
  }
  url.search = new URLSearchParams({ format: 'json', q: query }).toString();
  const parsed = SearxngSchema.safeParse(await request(url.toString(), {}, fetchImpl));
  if (!parsed.success) throw new WebSearchError(unreachableMessage, 'fetch-failed');
  return parsed.data.results.slice(0, maxResults).map((result) =>
    toResult({
      published: result.publishedDate,
      summary: result.content,
      title: result.title,
      url: result.url,
    }),
  );
}
