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

function provider() {
  return createYouTubeProvider({ search: async () => [candidate] });
}

describe('createYouTubeProvider', () => {
  it('describes a video by the signals a viewer would judge it on', () => {
    expect(provider().describeMeta(candidate)).toBe(
      'Computerphile · 1.2M views · 15:34 · published 2023-11-14',
    );
  });

  it('captures metadata as a reference without harvesting captions', async () => {
    const capture = await provider().capture(candidate, fetch);

    expect(capture.capturedVia).toBe('youtube-reference');
    expect(capture.url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(capture.content).toContain('Channel: Computerphile');
    expect(capture.content).toContain('does not harvest captions');
    expect(capture.content).toContain('supplied it, own it, or are authorized');
    expect(capture.content).not.toContain('## Transcript');
  });

  it('never offers the page-fetch upgrade, which cannot read a watch page', () => {
    expect(provider().capturedVia(candidate)).toBe('youtube-reference');
  });

  it('caps a run at eight videos', async () => {
    const many = Array.from({ length: 20 }, (_, index) => ({ ...candidate, key: `k${index}` }));
    const capped = createYouTubeProvider({
      search: async () => many,
    });

    expect(await capped.search(query, fetch)).toHaveLength(8);
  });
});
