import { describe, expect, it } from 'vitest';

import { createYouTubeProvider } from './youtube.js';

import { buildResearchQuery } from '../plan.js';
import type { ResearchCandidate } from '../types.js';

const query = buildResearchQuery('AI Fundamentals', { title: 'Describe attention' });

const candidate: ResearchCandidate = {
  communityScore: 1_200_000,
  key: 'youtube:dQw4w9WgXcQ',
  kind: 'video',
  meta: {
    channel: 'Computerphile',
    duration: '15:34',
    published: '2023-11-14',
    thumbnail: 'dQw4w9WgXcQ',
    views: '1.2M',
  },
  provider: 'youtube',
  score: 8,
  snippet: 'A walk through attention.',
  title: 'How attention works',
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
};

function provider(transcript: (videoId: string) => Promise<{ label: string; text: string }>) {
  return createYouTubeProvider({ search: async () => [candidate], transcript });
}

describe('createYouTubeProvider', () => {
  it('describes a video by the signals a viewer would judge it on', () => {
    expect(provider(async () => ({ label: 'English', text: 'x' })).describeMeta(candidate)).toBe(
      'Computerphile · 1.2M views · 15:34 · published 2023-11-14',
    );
  });

  it('captures the captions as readable text and says so in its provenance', async () => {
    let asked = '';
    const capture = await provider(async (videoId) => {
      asked = videoId;
      return { label: 'English (auto-generated)', text: 'Attention weighs every token.' };
    }).capture(candidate, fetch);

    expect(asked).toBe('dQw4w9WgXcQ');
    expect(capture.capturedVia).toBe('youtube-transcript');
    expect(capture.url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(capture.content).toContain('Channel: Computerphile');
    expect(capture.content).toContain('## Transcript');
    expect(capture.content).toContain('Attention weighs every token.');
    // Captions are machine transcription more often than not, and the document says so.
    expect(capture.content).toContain('often machine-generated');
  });

  it('stores an honest reference when a video has no captions', async () => {
    const capture = await provider(async () => {
      throw new Error('no-captions');
    }).capture(candidate, fetch);

    expect(capture.capturedVia).toBe('youtube-reference');
    expect(capture.content).toContain('No captions were available');
    expect(capture.content).not.toContain('## Transcript');
  });

  it('never offers the page-fetch upgrade, which cannot read a watch page', () => {
    expect(provider(async () => ({ label: 'English', text: 'x' })).capturedVia(candidate)).toBe(
      'youtube-reference',
    );
  });

  it('caps a run at eight videos', async () => {
    const many = Array.from({ length: 20 }, (_, index) => ({ ...candidate, key: `k${index}` }));
    const capped = createYouTubeProvider({
      search: async () => many,
      transcript: async () => ({ label: 'English', text: 'x' }),
    });

    expect(await capped.search(query, fetch)).toHaveLength(8);
  });
});
