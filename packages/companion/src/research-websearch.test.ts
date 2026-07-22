import { describe, expect, it } from 'vitest';

import { WebSearchError, searchWeb, webSearchConfig } from './research-websearch.js';

const braveKey = 'brave-secret-key';
const tavilyKey = 'tavily-secret-key';

function jsonFetch(
  body: unknown,
  capture?: (request: RequestInit | undefined, url: string) => void,
) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    capture?.(init, String(input));
    return Response.json(body);
  }) as unknown as typeof fetch;
}

describe('webSearchConfig', () => {
  it('reports nothing configured when no credentials are present', () => {
    expect(webSearchConfig({})).toBeNull();
  });

  it('infers the single configured upstream when the selector is unset', () => {
    expect(webSearchConfig({ BRAVE_API_KEY: braveKey })).toEqual({
      kind: 'brave',
      label: 'Brave Search',
    });
    expect(webSearchConfig({ TAVILY_API_KEY: tavilyKey })).toEqual({
      kind: 'tavily',
      label: 'Tavily',
    });
    expect(webSearchConfig({ SEARXNG_URL: 'http://127.0.0.1:8080' })).toEqual({
      kind: 'searxng',
      label: 'SearXNG',
    });
  });

  it('reports nothing configured when several credentials are present but none is selected', () => {
    expect(webSearchConfig({ BRAVE_API_KEY: braveKey, TAVILY_API_KEY: tavilyKey })).toBeNull();
  });

  it('honours RESEARCH_WEB_SEARCH when several credentials are present', () => {
    expect(
      webSearchConfig({
        BRAVE_API_KEY: braveKey,
        RESEARCH_WEB_SEARCH: 'tavily',
        TAVILY_API_KEY: tavilyKey,
      }),
    ).toEqual({ kind: 'tavily', label: 'Tavily' });
  });

  it('reports nothing configured when the selected upstream lacks its credential', () => {
    expect(webSearchConfig({ RESEARCH_WEB_SEARCH: 'brave' })).toBeNull();
    expect(
      webSearchConfig({ RESEARCH_WEB_SEARCH: 'nonsense', TAVILY_API_KEY: tavilyKey }),
    ).toBeNull();
  });

  it('never exposes the credential in the reported configuration', () => {
    expect(JSON.stringify(webSearchConfig({ BRAVE_API_KEY: braveKey }))).not.toContain(braveKey);
  });
});

describe('searchWeb', () => {
  it('throws a not-configured WebSearchError when no upstream is configured', async () => {
    const error = await searchWeb('x', { env: {} }).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(WebSearchError);
    expect((error as WebSearchError).reason).toBe('not-configured');
  });

  it('queries Brave with the subscription-token header and maps the results', async () => {
    let seenUrl = '';
    let seenInit: RequestInit | undefined;
    const results = await searchWeb('entra id', {
      env: { BRAVE_API_KEY: braveKey },
      fetchImpl: jsonFetch(
        {
          web: {
            results: [
              {
                age: '2024-01-02T00:00:00Z',
                description: 'Brave  summary',
                title: 'Brave title',
                url: 'https://example.org/a',
              },
              { title: 'No description', url: 'https://example.org/b' },
            ],
          },
        },
        (init, url) => {
          seenInit = init;
          seenUrl = url;
        },
      ),
    });
    expect(seenUrl).toContain('https://api.search.brave.com/res/v1/web/search?');
    expect(seenUrl).toContain('q=entra+id');
    expect((seenInit?.headers as Record<string, string>)['X-Subscription-Token']).toBe(braveKey);
    expect(results).toEqual([
      {
        publishedAt: '2024-01-02T00:00:00Z',
        summary: 'Brave summary',
        title: 'Brave title',
        url: 'https://example.org/a',
      },
      { summary: '', title: 'No description', url: 'https://example.org/b' },
    ]);
  });

  it('posts the Tavily key in the body and maps the results', async () => {
    let seenUrl = '';
    let seenInit: RequestInit | undefined;
    const results = await searchWeb('entra id', {
      env: { TAVILY_API_KEY: tavilyKey },
      fetchImpl: jsonFetch(
        {
          results: [
            {
              content: 'Tavily summary',
              published_date: '2023-05-06',
              title: 'Tavily title',
              url: 'https://example.org/t',
            },
          ],
        },
        (init, url) => {
          seenInit = init;
          seenUrl = url;
        },
      ),
    });
    expect(seenUrl).toBe('https://api.tavily.com/search');
    expect(seenInit?.method).toBe('POST');
    expect(JSON.parse(String(seenInit?.body))).toMatchObject({
      api_key: tavilyKey,
      query: 'entra id',
    });
    expect(results).toEqual([
      {
        publishedAt: '2023-05-06',
        summary: 'Tavily summary',
        title: 'Tavily title',
        url: 'https://example.org/t',
      },
    ]);
  });

  it('queries a SearXNG instance in JSON mode and maps the results', async () => {
    let seenUrl = '';
    const results = await searchWeb('entra id', {
      env: { SEARXNG_URL: 'http://127.0.0.1:8080/' },
      fetchImpl: jsonFetch(
        {
          results: [
            {
              content: 'SearXNG summary',
              publishedDate: '2022-02-02',
              title: 'SearXNG title',
              url: 'https://example.org/s',
            },
          ],
        },
        (_init, url) => {
          seenUrl = url;
        },
      ),
    });
    expect(seenUrl).toContain('http://127.0.0.1:8080/search?');
    expect(seenUrl).toContain('q=entra+id');
    expect(seenUrl).toContain('format=json');
    expect(results).toEqual([
      {
        publishedAt: '2022-02-02',
        summary: 'SearXNG summary',
        title: 'SearXNG title',
        url: 'https://example.org/s',
      },
    ]);
  });

  it('caps the results at eight', async () => {
    const results = await searchWeb('x', {
      env: { TAVILY_API_KEY: tavilyKey },
      fetchImpl: jsonFetch({
        results: Array.from({ length: 20 }, (_unused, index) => ({
          content: 'c',
          title: `T${index}`,
          url: `https://example.org/${index}`,
        })),
      }),
    });
    expect(results).toHaveLength(8);
  });

  it('throws a fetch-failed WebSearchError on an upstream error status', async () => {
    const error = await searchWeb('x', {
      env: { BRAVE_API_KEY: braveKey },
      fetchImpl: (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch,
    }).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(WebSearchError);
    expect((error as WebSearchError).reason).toBe('fetch-failed');
  });

  it('throws a fetch-failed WebSearchError on an unfamiliar body shape', async () => {
    const error = await searchWeb('x', {
      env: { TAVILY_API_KEY: tavilyKey },
      fetchImpl: jsonFetch({ unexpected: true }),
    }).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(WebSearchError);
    expect((error as WebSearchError).reason).toBe('fetch-failed');
  });

  it('throws a fetch-failed WebSearchError when fetch itself fails', async () => {
    const error = await searchWeb('x', {
      env: { BRAVE_API_KEY: braveKey },
      fetchImpl: (async () => {
        throw new Error(`network down while sending ${braveKey}`);
      }) as unknown as typeof fetch,
    }).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(WebSearchError);
    expect((error as WebSearchError).reason).toBe('fetch-failed');
    expect(String((error as WebSearchError).message)).not.toContain(braveKey);
    expect(JSON.stringify((error as WebSearchError).stack ?? '')).not.toContain(braveKey);
  });

  it('never leaks the credential into the returned results', async () => {
    const results = await searchWeb('x', {
      env: { BRAVE_API_KEY: braveKey },
      fetchImpl: jsonFetch({
        web: { results: [{ description: 'd', title: 't', url: 'https://example.org/a' }] },
      }),
    });
    expect(JSON.stringify(results)).not.toContain(braveKey);
  });
});
