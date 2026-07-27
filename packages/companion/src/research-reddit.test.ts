import { describe, expect, it, vi } from 'vitest';

import { RedditProxyError, redditConfig, searchReddit } from './research-reddit.js';

const env = { REDDIT_CLIENT_ID: 'client-id', REDDIT_CLIENT_SECRET: 'client-secret' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

function listing(children: unknown[]): Response {
  return json({ data: { children } });
}

function post(overrides: Record<string, unknown> = {}): { data: Record<string, unknown> } {
  return {
    data: {
      created_utc: 1_620_000_000,
      id: 'abc123',
      num_comments: 42,
      over_18: false,
      permalink: '/r/kubernetes/comments/abc123/how_do_pods_work/',
      score: 310,
      selftext: 'A pod groups containers that share a network namespace.',
      subreddit: 'kubernetes',
      title: 'How do pods work?',
      ...overrides,
    },
  };
}

/** Answers the token request first, then the search, the way Reddit's app-only flow runs. */
function stub(searchResponse: Response) {
  return vi.fn(async (input: string | URL | Request, _init?: RequestInit) =>
    String(input).includes('access_token')
      ? json({ access_token: 'token-value', expires_in: 86_400 })
      : searchResponse,
  );
}

describe('redditConfig', () => {
  it('reports Reddit as usable when both halves of the credential are set', () => {
    expect(redditConfig(env)).toEqual({ label: 'Reddit' });
  });

  it('reports nothing when only one half is set', () => {
    expect(redditConfig({ REDDIT_CLIENT_ID: 'client-id' })).toBeNull();
    expect(redditConfig({ REDDIT_CLIENT_SECRET: 'client-secret' })).toBeNull();
  });

  it('treats blank values as unset', () => {
    expect(redditConfig({ REDDIT_CLIENT_ID: '  ', REDDIT_CLIENT_SECRET: '  ' })).toBeNull();
  });
});

describe('searchReddit', () => {
  it('explains how to configure Reddit when no credential is set', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const failure = await searchReddit('kubernetes', { env: {}, fetchImpl }).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(RedditProxyError);
    expect((failure as RedditProxyError).reason).toBe('not-configured');
    expect((failure as RedditProxyError).message).toContain('REDDIT_CLIENT_ID');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('exchanges the credential for an app-only token before searching', async () => {
    const fetchMock = stub(listing([post()]));

    await searchReddit('kubernetes', { env, fetchImpl: fetchMock as unknown as typeof fetch });

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0]!;
    expect(String(tokenUrl)).toBe('https://www.reddit.com/api/v1/access_token');
    expect(tokenInit?.method).toBe('POST');
    expect(String(tokenInit?.body)).toContain('grant_type=client_credentials');
    expect((tokenInit?.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`,
    );
  });

  it('searches the oauth host with the bearer token and a descriptive user agent', async () => {
    const fetchMock = stub(listing([post()]));

    await searchReddit('kubernetes pods', {
      env,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const [searchUrl, searchInit] = fetchMock.mock.calls[1]!;
    expect(String(searchUrl)).toContain('https://oauth.reddit.com/search');
    expect(String(searchUrl)).toContain('q=kubernetes+pods');
    expect(String(searchUrl)).toContain('sort=relevance');
    const headers = searchInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-value');
    expect(headers['User-Agent']).toMatch(/dusori/iu);
  });

  it('reads a listing into results ordered as Reddit returned them', async () => {
    const fetchImpl = stub(
      listing([post(), post({ id: 'def456', title: 'Second' })]),
    ) as unknown as typeof fetch;

    const results = await searchReddit('kubernetes pods', { env, fetchImpl });

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      comments: 42,
      id: 'abc123',
      publishedAt: '2021-05-03',
      score: 310,
      subreddit: 'kubernetes',
      summary: 'A pod groups containers that share a network namespace.',
      title: 'How do pods work?',
      url: 'https://www.reddit.com/r/kubernetes/comments/abc123/how_do_pods_work/',
    });
  });

  it('leaves out posts marked over 18', async () => {
    const fetchImpl = stub(
      listing([post({ over_18: true }), post({ id: 'keep', over_18: false })]),
    ) as unknown as typeof fetch;

    const results = await searchReddit('kubernetes', { env, fetchImpl });

    expect(results.map((result) => result.id)).toEqual(['keep']);
  });

  it('keeps a link post that has no self text', async () => {
    const fetchImpl = stub(listing([post({ selftext: '' })])) as unknown as typeof fetch;

    const [first] = await searchReddit('kubernetes', { env, fetchImpl });

    expect(first?.summary).toBe('');
  });

  it('skips an entry with no title rather than failing the whole listing', async () => {
    const fetchImpl = stub(
      listing([post({ title: '' }), post({ id: 'keep' })]),
    ) as unknown as typeof fetch;

    const results = await searchReddit('kubernetes', { env, fetchImpl });

    expect(results.map((result) => result.id)).toEqual(['keep']);
  });

  it('returns at most eight results', async () => {
    const fetchImpl = stub(
      listing(Array.from({ length: 20 }, (_value, index) => post({ id: `id${index}` }))),
    ) as unknown as typeof fetch;

    await expect(searchReddit('kubernetes', { env, fetchImpl })).resolves.toHaveLength(8);
  });

  it('reports a rate limit as an unreachable proxy rather than a crash', async () => {
    const fetchImpl = stub(
      new Response('too many requests', { status: 429 }),
    ) as unknown as typeof fetch;

    const failure = await searchReddit('kubernetes', { env, fetchImpl }).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(RedditProxyError);
    expect((failure as RedditProxyError).reason).toBe('fetch-failed');
  });

  it('reports a rejected credential as an unreachable proxy', async () => {
    const fetchImpl = vi.fn(async () =>
      Promise.resolve(new Response('unauthorized', { status: 401 })),
    ) as unknown as typeof fetch;

    await expect(searchReddit('kubernetes', { env, fetchImpl })).rejects.toBeInstanceOf(
      RedditProxyError,
    );
  });

  it('reports a network failure as an unreachable proxy', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;

    await expect(searchReddit('kubernetes', { env, fetchImpl })).rejects.toBeInstanceOf(
      RedditProxyError,
    );
  });

  it('reports an unfamiliar body as an unfamiliar listing', async () => {
    const fetchImpl = stub(json({ nope: true })) as unknown as typeof fetch;

    await expect(searchReddit('kubernetes', { env, fetchImpl })).rejects.toThrow(/unfamiliar/iu);
  });
});
