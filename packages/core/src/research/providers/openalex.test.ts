import { describe, expect, it, vi } from 'vitest';

import { maxSourceBytes } from '../../sources/import.js';
import { openAlexProvider } from './openalex.js';

const query = {
  objectiveTitle: 'Explain container orchestration',
  searchText: 'Cloud native Explain container orchestration',
  terms: ['explain', 'container', 'orchestration', 'cloud', 'native'],
  topicTitle: 'Cloud native',
};

const searchFixture = {
  results: [
    {
      abstract_inverted_index: { Containers: [0], are: [1], portable: [2] },
      authorships: [
        { author: { display_name: 'David Bernstein' } },
        { author: { display_name: 'Ada Lovelace' } },
      ],
      cited_by_count: 1098,
      display_name: 'Containers and Cloud: From LXC to Docker to Kubernetes',
      doi: 'https://doi.org/10.1109/mcc.2014.51',
      id: 'https://openalex.org/W2023953679',
      primary_location: {
        landing_page_url: 'https://ieeexplore.ieee.org/document/6968963',
        source: { display_name: 'IEEE Cloud Computing' },
      },
      publication_date: '2014-09-01',
      publication_year: 2014,
      type: 'article',
    },
    {
      abstract_inverted_index: null,
      authorships: [],
      cited_by_count: 12,
      display_name: 'A quieter paper',
      doi: null,
      id: 'https://openalex.org/W99',
      primary_location: null,
      publication_date: '2021-02-03',
      publication_year: 2021,
      type: 'article',
    },
  ],
};

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  });
}

describe('OpenAlex research provider', () => {
  it('names its exact egress host in the disclosure', () => {
    expect(openAlexProvider.disclosure).toContain('api.openalex.org');
  });

  it('parses works into ranked candidates carrying citations and publication date', async () => {
    const fetchMock = vi.fn<(input: string | URL | Request) => Promise<Response>>(async () =>
      Promise.resolve(response(searchFixture)),
    );

    const results = await openAlexProvider.search(query, fetchMock as unknown as typeof fetch);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      communityScore: 1098,
      key: 'openalex:W2023953679',
      kind: 'paper',
      provider: 'openalex',
      publishedAt: '2014-09-01',
      snippet: 'Containers are portable',
      title: 'Containers and Cloud: From LXC to Docker to Kubernetes',
      url: 'https://doi.org/10.1109/mcc.2014.51',
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      'search=Cloud+native+Explain+container+orchestration',
    );
  });

  it('falls back to the landing page and then the OpenAlex record for a work without a doi', async () => {
    const fetchImpl = vi.fn(async () =>
      Promise.resolve(response(searchFixture)),
    ) as unknown as typeof fetch;

    const results = await openAlexProvider.search(query, fetchImpl);

    expect(results[1]?.url).toBe('https://openalex.org/W99');
    expect(results[1]?.snippet).toBe('');
  });

  it('describes citations and venue on the candidate card', async () => {
    const fetchImpl = vi.fn(async () =>
      Promise.resolve(response(searchFixture)),
    ) as unknown as typeof fetch;

    const [first] = await openAlexProvider.search(query, fetchImpl);

    expect(openAlexProvider.describeMeta(first!)).toContain('1098 citations');
    expect(openAlexProvider.describeMeta(first!)).toContain('IEEE Cloud Computing');
  });

  it('captures the abstract by rebuilding the inverted index in word order', async () => {
    const fetchImpl = vi.fn(async () =>
      Promise.resolve(
        response({
          abstract_inverted_index: {
            Kubernetes: [0],
            containers: [3],
            orchestrates: [1],
            'across hosts.': [4],
            many: [2],
          },
          display_name: 'Containers and Cloud',
          id: 'https://openalex.org/W2023953679',
        }),
      ),
    ) as unknown as typeof fetch;
    const candidate = {
      key: 'openalex:W2023953679',
      meta: {},
      provider: 'openalex',
      score: 2,
      snippet: '',
      title: 'Containers and Cloud',
      url: 'https://doi.org/10.1109/mcc.2014.51',
    };

    const capture = await openAlexProvider.capture(candidate, fetchImpl);

    expect(capture.capturedVia).toBe('api-abstract');
    expect(capture.content).toContain('Kubernetes orchestrates many containers across hosts.');
    expect(capture.content).toContain('Original URL: <https://doi.org/10.1109/mcc.2014.51>');
  });

  it('refuses a work identifier that is not an OpenAlex work key', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(
      openAlexProvider.capture(
        {
          key: 'openalex:../../etc/passwd',
          meta: {},
          provider: 'openalex',
          score: 1,
          snippet: '',
          title: 'Bad',
          url: 'https://example.com',
        },
        fetchImpl,
      ),
    ).rejects.toThrow(/invalid work identifier/iu);
  });

  it('explains itself when a work has no abstract to capture', async () => {
    const fetchImpl = vi.fn(async () =>
      Promise.resolve(
        response({
          abstract_inverted_index: null,
          display_name: 'A quieter paper',
          id: 'https://openalex.org/W99',
        }),
      ),
    ) as unknown as typeof fetch;

    const capture = await openAlexProvider.capture(
      {
        key: 'openalex:W99',
        meta: {},
        provider: 'openalex',
        score: 1,
        snippet: '',
        title: 'A quieter paper',
        url: 'https://openalex.org/W99',
      },
      fetchImpl,
    );

    expect(capture.capturedVia).toBe('search-reference');
    expect(capture.content).toContain('OpenAlex has no abstract for this work');
  });

  it('truncates a long abstract below the source cap', async () => {
    const fetchImpl = vi.fn(async () =>
      Promise.resolve(
        response({
          abstract_inverted_index: { ['é'.repeat(maxSourceBytes)]: [0] },
          display_name: 'Long',
          id: 'https://openalex.org/W1',
        }),
      ),
    ) as unknown as typeof fetch;

    const capture = await openAlexProvider.capture(
      {
        key: 'openalex:W1',
        meta: {},
        provider: 'openalex',
        score: 1,
        snippet: '',
        title: 'Long',
        url: 'https://openalex.org/W1',
      },
      fetchImpl,
    );

    expect(new TextEncoder().encode(capture.content).byteLength).toBeLessThanOrEqual(
      maxSourceBytes,
    );
  });
});
