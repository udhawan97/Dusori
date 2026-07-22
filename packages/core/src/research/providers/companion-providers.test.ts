import { describe, expect, it } from 'vitest';

import { buildResearchQuery } from '../plan.js';
import type { ResearchCandidate } from '../types.js';
import { createArxivProvider } from './arxiv.js';
import { createWebSearchProvider } from './websearch.js';

const query = buildResearchQuery('Machine learning', { title: 'Understand attention' });

function candidate(overrides: Partial<ResearchCandidate> = {}): ResearchCandidate {
  return {
    key: 'arxiv:1706.03762',
    kind: 'paper',
    meta: { published: '2017-06-12' },
    provider: 'arxiv',
    score: 8,
    snippet: 'The dominant sequence transduction models are based on recurrent networks.',
    title: 'Attention Is All You Need',
    url: 'https://arxiv.org/abs/1706.03762',
    ...overrides,
  };
}

describe('arXiv provider', () => {
  it('returns what the companion proxy found, capped at eight', async () => {
    const many = Array.from({ length: 12 }, (_item, index) => candidate({ key: `arxiv:${index}` }));
    const provider = createArxivProvider({ search: async () => many });

    expect(await provider.search(query, fetch)).toHaveLength(8);
  });

  it('captures a reference that names the paper and stays honest about what it is', async () => {
    const provider = createArxivProvider({ search: async () => [] });

    const capture = await provider.capture(candidate(), fetch);

    expect(capture.title).toBe('Attention Is All You Need');
    expect(capture.content).toContain('Original URL: <https://arxiv.org/abs/1706.03762>');
    expect(capture.content).toContain('## Abstract');
    expect(capture.content).toContain('- Published: 2017-06-12');
    expect(capture.content).toContain('not a snapshot of the paper');
  });

  it('describes the publication date and records how it was captured', () => {
    const provider = createArxivProvider({ search: async () => [] });

    expect(provider.describeMeta(candidate())).toBe('published 2017-06-12');
    expect(provider.describeMeta(candidate({ meta: {} }))).toBe('');
    expect(provider.capturedVia(candidate())).toBe('search-reference');
  });

  it('lets a proxy failure surface rather than pretending there were no papers', async () => {
    const provider = createArxivProvider({
      search: async () => {
        throw new Error('companion unreachable');
      },
    });

    await expect(provider.search(query, fetch)).rejects.toThrow(/companion unreachable/u);
  });
});

describe('web search provider', () => {
  const webCandidate = candidate({
    key: 'websearch:https://example.com/guide',
    kind: 'article',
    meta: { host: 'example.com', published: '2026-01-04' },
    provider: 'websearch',
    title: 'A practical guide',
    url: 'https://example.com/guide',
  });

  it('captures a stub that points at the full-content upgrade', async () => {
    const provider = createWebSearchProvider({ search: async () => [] });

    const capture = await provider.capture(webCandidate, fetch);

    expect(capture.content).toContain('Original URL: <https://example.com/guide>');
    expect(capture.content).toContain('not a snapshot of the page');
    expect(capture.content).toContain('Fetch full content');
  });

  it('describes the host and date it was given', () => {
    const provider = createWebSearchProvider({ search: async () => [] });

    expect(provider.describeMeta(webCandidate)).toBe('example.com · published 2026-01-04');
    expect(provider.describeMeta(candidate({ meta: { host: 'example.com' } }))).toBe('example.com');
  });
});
