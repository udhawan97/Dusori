import { describe, expect, it, vi } from 'vitest';

import { maxSourceBytes } from '../../sources/import.js';
import type { ResearchCandidate } from '../types.js';
import { createRedditProvider } from './reddit.js';

const query = {
  objectiveTitle: 'Explain pod networking',
  searchText: 'Kubernetes Explain pod networking',
  terms: ['explain', 'pod', 'networking', 'kubernetes'],
  topicTitle: 'Kubernetes',
};

function candidate(overrides: Partial<ResearchCandidate> = {}): ResearchCandidate {
  return {
    communityScore: 310,
    key: 'reddit:abc123',
    kind: 'qa',
    meta: {
      comments: '42',
      community: '310 points',
      published: '2021-05-03',
      subreddit: 'r/kubernetes',
    },
    provider: 'reddit',
    score: 8,
    snippet: 'A pod groups containers that share a network namespace.',
    title: 'How do pods work?',
    url: 'https://www.reddit.com/r/kubernetes/comments/abc123/how_do_pods_work/',
    ...overrides,
  };
}

describe('Reddit research provider', () => {
  it('says in its disclosure that the companion makes the call and a credential is required', () => {
    const provider = createRedditProvider({ search: async () => [] });

    expect(provider.disclosure).toContain('oauth.reddit.com');
    expect(provider.disclosure).toContain('companion');
    expect(provider.disclosure).toMatch(/credential/iu);
    expect(provider.disclosure).toMatch(/skipped/iu);
  });

  it('passes the query to the companion and caps the shortlist at eight', async () => {
    const search = vi.fn(async () =>
      Array.from({ length: 20 }, (_value, index) => candidate({ key: `reddit:${index}` })),
    );
    const provider = createRedditProvider({ search });

    const results = await provider.search(query, fetch);

    expect(results).toHaveLength(8);
    expect(search).toHaveBeenCalledWith(query);
  });

  it('describes the subreddit, score, comments, and date on the candidate card', () => {
    const provider = createRedditProvider({ search: async () => [] });

    const described = provider.describeMeta(candidate());

    expect(described).toContain('r/kubernetes');
    expect(described).toContain('310 points');
    expect(described).toContain('42 comments');
    expect(described).toContain('posted 2021-05-03');
  });

  it('captures a self post as its own text and records that replies are excluded', async () => {
    const provider = createRedditProvider({ search: async () => [] });

    const capture = await provider.capture(candidate(), fetch);

    expect(capture.content).toContain('A pod groups containers that share a network namespace.');
    expect(capture.content).toContain('Replies are not included');
    expect(capture.content).toContain('r/kubernetes');
  });

  it('captures a link post as a reference that says it has no text of its own', async () => {
    const provider = createRedditProvider({ search: async () => [] });

    const capture = await provider.capture(candidate({ snippet: '' }), fetch);

    expect(capture.content).toContain('no text of its own');
  });

  it('reports how a post was captured so provenance matches what was obtained', () => {
    const provider = createRedditProvider({ search: async () => [] });

    expect(provider.capturedVia(candidate())).toBe('api-extract');
    expect(provider.capturedVia(candidate({ snippet: '' }))).toBe('search-reference');
  });

  it('truncates a very long post below the source cap', async () => {
    const provider = createRedditProvider({ search: async () => [] });

    const capture = await provider.capture(
      candidate({ snippet: 'é'.repeat(maxSourceBytes) }),
      fetch,
    );

    expect(new TextEncoder().encode(capture.content).byteLength).toBeLessThanOrEqual(
      maxSourceBytes,
    );
  });
});
