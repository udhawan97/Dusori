import { describe, expect, it } from 'vitest';

import {
  YouTubeError,
  fetchYouTubeThumbnail,
  searchYouTube,
  youtubeConfig,
} from './research-youtube.js';

const env = { INVIDIOUS_URL: 'https://yewtu.example/' };
const officialEnv = { YOUTUBE_API_KEY: 'youtube-secret-key' };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
}

const searchBody = [
  {
    author: 'Computerphile',
    lengthSeconds: 934,
    published: 1_700_000_000,
    title: 'How attention works',
    videoId: 'dQw4w9WgXcQ',
    viewCount: 1_200_000,
  },
  {
    author: 'No description channel',
    description: 'Second video.',
    lengthSeconds: 120,
    title: 'Positional encodings',
    videoId: 'aBcDeFgHiJk',
    viewCount: 5000,
  },
];

describe('youtubeConfig', () => {
  it('reports nothing when no instance is configured', () => {
    expect(youtubeConfig({})).toBeNull();
    expect(youtubeConfig({ INVIDIOUS_URL: '   ' })).toBeNull();
  });

  it('prefers the official API without exposing its key', () => {
    expect(youtubeConfig({ ...env, ...officialEnv })).toEqual({ kind: 'youtube-data-api' });
  });

  it('reports the host without trailing slashes', () => {
    expect(youtubeConfig(env)).toEqual({
      base: 'https://yewtu.example',
      host: 'yewtu.example',
      kind: 'invidious',
    });
  });

  it('rejects an instance address that is not http(s)', () => {
    expect(youtubeConfig({ INVIDIOUS_URL: 'file:///etc/passwd' })).toBeNull();
  });
});

describe('searchYouTube', () => {
  it('uses the official Data API for bounded metadata and never requests captions or media', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      seen.push(url);
      if (url.startsWith('https://www.googleapis.com/youtube/v3/search')) {
        return jsonResponse({
          items: [
            {
              id: { videoId: 'dQw4w9WgXcQ' },
              snippet: { title: 'Search title that details may refine' },
            },
          ],
        });
      }
      return jsonResponse({
        items: [
          {
            contentDetails: { duration: 'PT15M34S' },
            id: 'dQw4w9WgXcQ',
            snippet: {
              channelTitle: 'Computerphile',
              description: 'How attention works.',
              publishedAt: '2023-11-14T12:00:00Z',
              title: 'How attention works',
            },
            statistics: { viewCount: '1200000' },
          },
        ],
      });
    }) as typeof fetch;

    const results = await searchYouTube('attention transformers', {
      env: officialEnv,
      fetchImpl,
    });

    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain('https://www.googleapis.com/youtube/v3/search');
    expect(seen[0]).toContain('part=snippet');
    expect(seen[0]).toContain('type=video');
    expect(seen[0]).toContain('maxResults=8');
    expect(seen[1]).toContain('https://www.googleapis.com/youtube/v3/videos');
    expect(seen[1]).toContain('part=contentDetails%2Csnippet%2Cstatistics');
    expect(seen.join('\n')).not.toMatch(/caption|transcript|download/iu);
    expect(results).toEqual([
      {
        author: 'Computerphile',
        id: 'dQw4w9WgXcQ',
        lengthSeconds: 934,
        publishedAt: '2023-11-14',
        summary: 'How attention works.',
        title: 'How attention works',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        viewCount: 1_200_000,
      },
    ]);
  });

  it('falls back to the configured self-hosted instance when the official API is unavailable', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      seen.push(url);
      if (url.startsWith('https://www.googleapis.com/')) return new Response(null, { status: 503 });
      return jsonResponse(searchBody);
    }) as typeof fetch;

    const results = await searchYouTube('attention', {
      env: { ...env, ...officialEnv },
      fetchImpl,
    });

    expect(seen.at(-1)).toContain('https://yewtu.example/api/v1/search');
    expect(results[0]?.title).toBe('How attention works');
  });

  it('asks the configured instance for the most viewed videos', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
      seen.push(String(input));
      return jsonResponse(searchBody);
    }) as typeof fetch;

    const results = await searchYouTube('attention transformers', { env, fetchImpl });

    expect(seen[0]).toContain('https://yewtu.example/api/v1/search');
    expect(seen[0]).toContain('sort_by=view_count');
    expect(seen[0]).toContain('type=video');
    expect(seen[0]).toContain('q=attention+transformers');
    expect(results[0]).toEqual({
      author: 'Computerphile',
      id: 'dQw4w9WgXcQ',
      lengthSeconds: 934,
      publishedAt: '2023-11-14',
      summary: '',
      title: 'How attention works',
      // Canonical YouTube address, so a saved source outlives the instance.
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      viewCount: 1_200_000,
    });
    expect(results[1]?.summary).toBe('Second video.');
    expect(results[1]?.publishedAt).toBeUndefined();
  });

  it('reports an unconfigured instance without touching the network', async () => {
    const fetchImpl = (async () => {
      throw new Error('must not be called');
    }) as typeof fetch;

    await expect(searchYouTube('q', { env: {}, fetchImpl })).rejects.toMatchObject({
      reason: 'not-configured',
    });
  });

  it('turns an unfamiliar answer into a fixed failure', async () => {
    const fetchImpl = (async () => jsonResponse({ nope: true })) as typeof fetch;
    const failure = await searchYouTube('q', { env, fetchImpl }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(YouTubeError);
    expect((failure as YouTubeError).reason).toBe('fetch-failed');
  });
});

describe('fetchYouTubeThumbnail', () => {
  it('uses the fixed image host when the official API is configured', async () => {
    let seen = '';
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
      seen = String(input);
      return new Response(new Uint8Array([1]), {
        headers: { 'Content-Type': 'image/jpeg' },
        status: 200,
      });
    }) as typeof fetch;

    await fetchYouTubeThumbnail('dQw4w9WgXcQ', { env: officialEnv, fetchImpl });
    expect(seen).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg');
  });

  it('returns the image bytes and its type', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
      seen.push(String(input));
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'Content-Type': 'image/jpeg' },
        status: 200,
      });
    }) as typeof fetch;

    const image = await fetchYouTubeThumbnail('dQw4w9WgXcQ', { env, fetchImpl });

    expect(seen[0]).toBe('https://yewtu.example/vi/dQw4w9WgXcQ/mqdefault.jpg');
    expect(image.contentType).toBe('image/jpeg');
    expect(image.body).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('refuses anything that is not an image', async () => {
    const fetchImpl = (async () =>
      new Response('<html>gotcha</html>', {
        headers: { 'Content-Type': 'text/html' },
        status: 200,
      })) as typeof fetch;

    await expect(fetchYouTubeThumbnail('dQw4w9WgXcQ', { env, fetchImpl })).rejects.toMatchObject({
      reason: 'unsupported-type',
    });
  });

  it('refuses an image beyond the size cap', async () => {
    const fetchImpl = (async () =>
      new Response(new Uint8Array(3 * 1024 * 1024), {
        headers: { 'Content-Type': 'image/jpeg' },
        status: 200,
      })) as typeof fetch;

    await expect(fetchYouTubeThumbnail('dQw4w9WgXcQ', { env, fetchImpl })).rejects.toMatchObject({
      reason: 'too-large',
    });
  });
});
