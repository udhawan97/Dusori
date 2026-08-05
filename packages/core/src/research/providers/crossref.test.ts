import { describe, expect, it, vi } from 'vitest';

import { crossrefProvider } from './crossref.js';

const query = {
  objectiveTitle: 'Explain retrieval practice',
  searchText: 'Learning science Explain retrieval practice',
  terms: ['explain', 'retrieval', 'practice', 'learning', 'science'],
  topicTitle: 'Learning science',
};

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  });
}

const work = {
  DOI: '10.1000/attention.1',
  URL: 'https://example.org/publisher',
  abstract: '<jats:p>Retrieval practice strengthens later recall.</jats:p>',
  author: [{ family: 'Karpicke', given: 'Jeffrey' }],
  'container-title': ['Science'],
  'is-referenced-by-count': 321,
  published: { 'date-parts': [[2023, 4, 2]] },
  title: ['Retrieval practice and durable learning'],
  type: 'journal-article',
};

describe('Crossref research provider', () => {
  it('searches the public works index and returns usable scholarly metadata', async () => {
    const fetchImpl = vi.fn(async () =>
      response({ message: { items: [work] } }),
    ) as unknown as typeof fetch;

    const [candidate] = await crossrefProvider.search(query, fetchImpl);

    expect(candidate).toMatchObject({
      communityScore: 321,
      key: 'crossref:10.1000/attention.1',
      kind: 'paper',
      provider: 'crossref',
      publishedAt: '2023-04-02',
      snippet: 'Retrieval practice strengthens later recall.',
      url: 'https://doi.org/10.1000/attention.1',
    });
    expect(String((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])).toContain(
      'query.bibliographic=Learning+science',
    );
  });

  it('captures an abstract and clearly downgrades a metadata-only record', async () => {
    const withAbstract = vi.fn(async () => response({ message: work })) as unknown as typeof fetch;
    const candidate = {
      key: 'crossref:10.1000/attention.1',
      meta: {},
      provider: 'crossref',
      score: 1,
      snippet: '',
      title: 'Retrieval practice and durable learning',
      url: 'https://doi.org/10.1000/attention.1',
    };

    const readable = await crossrefProvider.capture(candidate, withAbstract);
    expect(readable.capturedVia).toBe('api-abstract');
    expect(readable.content).toContain('## Abstract');
    expect(readable.content).toContain('Retrieval practice strengthens later recall.');

    const withoutAbstract = vi.fn(async () =>
      response({ message: { ...work, abstract: null } }),
    ) as unknown as typeof fetch;
    const reference = await crossrefProvider.capture(candidate, withoutAbstract);
    expect(reference.capturedVia).toBe('search-reference');
    expect(reference.content).toContain('no abstract');
  });
});
