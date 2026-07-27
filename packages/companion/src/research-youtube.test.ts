import { describe, expect, it } from 'vitest';

import {
  YouTubeError,
  fetchYouTubeThumbnail,
  fetchYouTubeTranscript,
  searchYouTube,
  youtubeConfig,
} from './research-youtube.js';

const env = { INVIDIOUS_URL: 'https://yewtu.example/' };

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

  it('reports the host without trailing slashes', () => {
    expect(youtubeConfig(env)).toEqual({ base: 'https://yewtu.example', host: 'yewtu.example' });
  });

  it('rejects an instance address that is not http(s)', () => {
    expect(youtubeConfig({ INVIDIOUS_URL: 'file:///etc/passwd' })).toBeNull();
  });
});

describe('searchYouTube', () => {
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

describe('fetchYouTubeTranscript', () => {
  const captions = {
    captions: [
      { label: 'German', language_code: 'de', url: '/api/v1/captions/dQw4w9WgXcQ?label=German' },
      { label: 'English', language_code: 'en', url: '/api/v1/captions/dQw4w9WgXcQ?label=English' },
    ],
  };
  const vtt = `WEBVTT
Kind: captions
Language: en

00:00:01.000 --> 00:00:04.000
Attention lets each token weigh

00:00:04.000 --> 00:00:07.000
Attention lets each token weigh
every other token.

00:00:07.500 --> 00:00:09.000
<c>That weighted sum</c> becomes the next representation.
`;

  it('prefers an English track and returns readable text', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      seen.push(url);
      if (url.includes('label=')) return new Response(vtt, { status: 200 });
      return jsonResponse(captions);
    }) as typeof fetch;

    const transcript = await fetchYouTubeTranscript('dQw4w9WgXcQ', { env, fetchImpl });

    expect(seen[1]).toBe('https://yewtu.example/api/v1/captions/dQw4w9WgXcQ?label=English');
    expect(transcript.label).toBe('English');
    expect(transcript.text).toBe(
      'Attention lets each token weigh every other token. That weighted sum becomes the next representation.',
    );
  });

  it('reports a video that carries no captions', async () => {
    const fetchImpl = (async () => jsonResponse({ captions: [] })) as typeof fetch;

    await expect(fetchYouTubeTranscript('dQw4w9WgXcQ', { env, fetchImpl })).rejects.toMatchObject({
      reason: 'no-captions',
    });
  });

  it('refuses an id that is not a YouTube video id', async () => {
    const fetchImpl = (async () => {
      throw new Error('must not be called');
    }) as typeof fetch;

    await expect(
      fetchYouTubeTranscript('../../etc/passwd', { env, fetchImpl }),
    ).rejects.toMatchObject({ reason: 'invalid-id' });
  });
});

describe('fetchYouTubeThumbnail', () => {
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
