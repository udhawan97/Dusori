import { describe, expect, it } from 'vitest';

import { CompanionFetchError, createCompanionResearchClient } from './companion.js';
import type { ResearchQuery } from './types.js';

const query: ResearchQuery = {
  objectiveTitle: 'Configure Entra ID',
  searchText: 'AZ-104 Configure Entra ID',
  terms: ['entra'],
  topicTitle: 'AZ-104',
};

const page = {
  fetchedAt: '2026-07-21T00:00:00.000Z',
  finalUrl: 'https://example.org/attention',
  text: 'Attention lets each token weigh the other tokens in its context.',
  title: 'Attention in transformers',
  truncated: false,
};

function client(fetchImpl: typeof fetch) {
  return createCompanionResearchClient({
    baseUrl: 'http://127.0.0.1:8000/',
    fetchImpl,
    token: 'secret',
  });
}

describe('createCompanionResearchClient', () => {
  it('POSTs the URL with the bearer token and parses the fetched page', async () => {
    let captured: { init?: RequestInit; input?: string } = {};
    const result = await client((async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = { init, input: String(input) };
      return Response.json(page);
    }) as unknown as typeof fetch).fetchPage('https://example.org/attention');
    expect(result).toEqual(page);
    expect(captured.input).toBe('http://127.0.0.1:8000/api/research/fetch');
    expect(captured.init?.method).toBe('POST');
    expect(new Headers(captured.init?.headers).get('authorization')).toBe('Bearer secret');
    expect(JSON.parse(String(captured.init?.body))).toEqual({
      url: 'https://example.org/attention',
    });
  });

  it('surfaces companion failure sentences and reasons as CompanionFetchError', async () => {
    const failing = client((async () =>
      Response.json(
        {
          error:
            "This address points at a private network and won't be fetched. Paste the text instead.",
          reason: 'blocked-host',
        },
        { status: 400 },
      )) as unknown as typeof fetch);
    await expect(failing.fetchPage('http://10.0.0.5/')).rejects.toMatchObject({
      message:
        "This address points at a private network and won't be fetched. Paste the text instead.",
      reason: 'blocked-host',
    });
    const dead = client((async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch);
    await expect(dead.fetchPage('https://example.org/')).rejects.toBeInstanceOf(
      CompanionFetchError,
    );
  });

  it('maps ranked search results into descending-score mslearn candidates', async () => {
    const results = await client((async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        'http://127.0.0.1:8000/api/research/mslearn-search?q=AZ-104%20Configure%20Entra%20ID',
      );
      return Response.json({
        results: [
          {
            summary: 'First summary.',
            title: 'First',
            url: 'https://learn.microsoft.com/en-us/first',
          },
          {
            summary: 'Second summary.',
            title: 'Second',
            url: 'https://learn.microsoft.com/en-us/second',
          },
        ],
      });
    }) as unknown as typeof fetch).searchMsLearnRanked(query);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      key: 'mslearn:https://learn.microsoft.com/en-us/first',
      provider: 'mslearn',
      score: 2,
      snippet: 'First summary.',
      title: 'First',
      url: 'https://learn.microsoft.com/en-us/first',
    });
    expect(results[1]!.score).toBe(1);
  });

  it('throws CompanionFetchError when the companion is unreachable for ranked search', async () => {
    const dead = client((async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch);
    await expect(dead.searchMsLearnRanked(query)).rejects.toBeInstanceOf(CompanionFetchError);
  });

  it('throws CompanionFetchError when the ranked search response has an unfamiliar shape', async () => {
    const malformed = client((async () =>
      Response.json({ nope: true })) as unknown as typeof fetch);
    await expect(malformed.searchMsLearnRanked(query)).rejects.toBeInstanceOf(CompanionFetchError);
  });
});

describe('YouTube through the companion', () => {
  const results = [
    {
      author: 'Computerphile',
      id: 'dQw4w9WgXcQ',
      lengthSeconds: 934,
      publishedAt: '2023-11-14',
      summary: 'A walk through attention.',
      title: 'How attention works',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      viewCount: 1_200_000,
    },
  ];

  it('maps videos to candidates a viewer can judge', async () => {
    let asked = '';
    const candidates = await client((async (input: RequestInfo | URL) => {
      asked = String(input);
      return Response.json({ results });
    }) as unknown as typeof fetch).searchYouTube(query);

    expect(asked).toBe(
      'http://127.0.0.1:8000/api/research/youtube?q=AZ-104%20Configure%20Entra%20ID',
    );
    expect(candidates[0]).toEqual({
      communityScore: 1_200_000,
      key: 'youtube:dQw4w9WgXcQ',
      kind: 'video',
      meta: {
        channel: 'Computerphile',
        community: '1.2M views',
        duration: '15:34',
        published: '2023-11-14',
        thumbnail: 'dQw4w9WgXcQ',
        views: '1.2M',
      },
      provider: 'youtube',
      publishedAt: '2023-11-14',
      score: 1,
      snippet: 'A walk through attention.',
      title: 'How attention works',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });
  });

  it('carries the captions back and reports a captionless video', async () => {
    const captions = await client((async () =>
      Response.json({
        label: 'English',
        text: 'Attention weighs tokens.',
      })) as unknown as typeof fetch).fetchYouTubeTranscript('dQw4w9WgXcQ');
    expect(captions).toEqual({ label: 'English', text: 'Attention weighs tokens.' });

    const missing = client((async () =>
      Response.json(
        { error: 'This video has no captions to capture.', reason: 'no-captions' },
        {
          status: 404,
        },
      )) as unknown as typeof fetch);
    await expect(missing.fetchYouTubeTranscript('dQw4w9WgXcQ')).rejects.toMatchObject({
      reason: 'no-captions',
    });
  });

  it('accepts image bytes for a thumbnail and refuses anything else', async () => {
    let asked = '';
    const blob = await client((async (input: RequestInfo | URL) => {
      asked = String(input);
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'Content-Type': 'image/jpeg' },
        status: 200,
      });
    }) as unknown as typeof fetch).fetchYouTubeThumbnail('dQw4w9WgXcQ');

    expect(asked).toBe('http://127.0.0.1:8000/api/research/youtube-thumbnail?id=dQw4w9WgXcQ');
    expect(blob.type).toBe('image/jpeg');

    const html = client(
      (async () =>
        new Response('<html>', {
          headers: { 'Content-Type': 'text/html' },
          status: 200,
        })) as unknown as typeof fetch,
    );
    await expect(html.fetchYouTubeThumbnail('dQw4w9WgXcQ')).rejects.toBeInstanceOf(
      CompanionFetchError,
    );
  });
});
