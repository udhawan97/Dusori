import { describe, expect, it, vi } from 'vitest';

import { withAbortingFetchTimeout } from '../fetch-timeout.js';
import fixture from './__fixtures__/europepmc-search.json';
import { europePmcProvider } from './europepmc.js';

const query = {
  objectiveTitle: 'Review malaria vaccine evidence',
  searchText: 'Malaria vaccines Review clinical trial evidence',
  terms: ['malaria', 'vaccines', 'review', 'clinical', 'trial', 'evidence'],
  topicTitle: 'Malaria vaccines',
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

describe('Europe PMC research provider', () => {
  it('names its exact egress host in the disclosure', () => {
    expect(europePmcProvider.disclosure).toContain('www.ebi.ac.uk');
    expect(europePmcProvider.origins).toEqual(['https://www.ebi.ac.uk']);
  });

  it('searches core metadata with a bounded page and returns honest abstract cards', async () => {
    const fetchImpl = vi.fn(async () => response(fixture)) as unknown as typeof fetch;

    const results = await europePmcProvider.search(query, fetchImpl);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      communityScore: 42,
      key: 'europepmc:MED:12345678',
      kind: 'paper',
      provider: 'europepmc',
      publishedAt: '2024-03-02',
      snippet: 'Background Retrieval practice improves durable recall in clinical education.',
      url: 'https://doi.org/10.1000/clinical.1',
    });
    expect(results[1]?.url).toBe('https://europepmc.org/article/AGR/AGR-2');
    const requested = new URL(String((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]));
    expect(requested.searchParams.get('query')).toBe(query.searchText);
    expect(requested.searchParams.get('resultType')).toBe('core');
    expect(requested.searchParams.get('pageSize')).toBe('8');
  });

  it('captures only the returned abstract and downgrades metadata-only records', async () => {
    const fetchImpl = vi.fn(async () => response(fixture)) as unknown as typeof fetch;
    const [readableCandidate, referenceCandidate] = await europePmcProvider.search(
      query,
      fetchImpl,
    );

    const readable = await europePmcProvider.capture(readableCandidate!, fetchImpl);
    expect(readable.capturedVia).toBe('api-abstract');
    expect(readable.content).toContain('## Abstract');
    expect(readable.content).toContain('DOI: 10.1000/clinical.1');

    const reference = await europePmcProvider.capture(referenceCandidate!, fetchImpl);
    expect(reference.capturedVia).toBe('search-reference');
    expect(reference.content).toContain('no abstract');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects schema drift instead of inventing a result', async () => {
    const fetchImpl = vi.fn(async () => response({ items: [] })) as unknown as typeof fetch;

    await expect(europePmcProvider.search(query, fetchImpl)).rejects.toThrow(/unfamiliar/iu);
  });

  it('isolates rate limits and malformed JSON as provider failures', async () => {
    const rateLimited = vi.fn(async () => response({}, 429)) as unknown as typeof fetch;
    await expect(europePmcProvider.search(query, rateLimited)).rejects.toThrow(/could not read/iu);

    const malformed = vi.fn(
      async () => new Response('<html>not json</html>', { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(europePmcProvider.search(query, malformed)).rejects.toBeInstanceOf(Error);
  });

  it('aborts its in-flight API request when the research timeout expires', async () => {
    let aborted = false;
    const fetchImpl = ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('Aborted', 'AbortError'));
        });
      })) as typeof fetch;

    await expect(
      withAbortingFetchTimeout(fetchImpl, 10, 'Europe PMC timed out.', (scopedFetch) =>
        europePmcProvider.search(query, scopedFetch),
      ),
    ).rejects.toThrow(/timed out/iu);
    expect(aborted).toBe(true);
  });
});
