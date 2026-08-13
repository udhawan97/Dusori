import { describe, expect, it, vi } from 'vitest';

import { withAbortingFetchTimeout } from '../fetch-timeout.js';
import fixture from './__fixtures__/library-of-congress-search.json';
import { createLibraryOfCongressProvider } from './library-of-congress.js';

const query = {
  objectiveTitle: 'Find primary-source photographs',
  searchText: 'Civil rights archives Find primary-source photographs',
  terms: ['civil', 'rights', 'archives', 'find', 'primary', 'source', 'photographs'],
  topicTitle: 'Civil rights archives',
};

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json', ...headers },
    status,
  });
}

describe('Library of Congress research provider', () => {
  it('searches one bounded digitized-results page and accepts only canonical item records', async () => {
    const provider = createLibraryOfCongressProvider({ minimumIntervalMs: 0 });
    const fetchImpl = vi.fn(async () => response(fixture)) as unknown as typeof fetch;

    const results = await provider.search(query, fetchImpl);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      key: 'loc:2012649148',
      kind: 'article',
      provider: 'loc',
      publishedAt: '1962-01-01',
      snippet: '1 photographic print showing a civil rights march.',
      url: 'https://www.loc.gov/item/2012649148/',
    });
    expect(results[1]?.url).toBe('https://www.loc.gov/item/2019636974/');
    const requested = new URL(String((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]));
    expect(requested.searchParams.get('at')).toBe('results');
    expect(requested.searchParams.get('c')).toBe('24');
    expect(requested.searchParams.get('fa')).toBe('digitized:true');
    expect(requested.searchParams.get('fo')).toBe('json');
  });

  it('saves a catalog reference without fetching item media or implying reuse rights', async () => {
    const provider = createLibraryOfCongressProvider({ minimumIntervalMs: 0 });
    const fetchImpl = vi.fn(async () => response(fixture)) as unknown as typeof fetch;
    const [candidate] = await provider.search(query, fetchImpl);

    const capture = await provider.capture(candidate!, fetchImpl);

    expect(capture.capturedVia).toBe('search-reference');
    expect(capture.content).toContain('## Catalog record');
    expect(capture.content).toContain('did not fetch collection media or infer reuse rights');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('serializes request starts at no more than twenty per minute', async () => {
    let clock = 1_000;
    const waits: number[] = [];
    const provider = createLibraryOfCongressProvider({
      minimumIntervalMs: 3_000,
      now: () => clock,
      wait: async (milliseconds) => {
        waits.push(milliseconds);
        clock += milliseconds;
      },
    });
    const fetchImpl = vi.fn(async () => response({ results: [] })) as unknown as typeof fetch;

    await provider.search(query, fetchImpl);
    await provider.search(query, fetchImpl);

    expect(waits).toEqual([3_000]);
  });

  it('records Retry-After as a local backoff and never retries automatically', async () => {
    let clock = 10_000;
    const provider = createLibraryOfCongressProvider({ minimumIntervalMs: 0, now: () => clock });
    const fetchImpl = vi.fn(async () =>
      response({}, 429, { 'retry-after': '10' }),
    ) as unknown as typeof fetch;

    await expect(provider.search(query, fetchImpl)).rejects.toThrow(/rate-limited/iu);
    await expect(provider.search(query, fetchImpl)).rejects.toThrow(/wait before another/iu);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    clock += 10_000;
    await expect(provider.search(query, fetchImpl)).rejects.toThrow(/rate-limited/iu);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('stops a queued request when the preceding in-flight request sets Retry-After', async () => {
    let clock = 10_000;
    let finishWait = (): void => undefined;
    let finishFirst = (): void => undefined;
    const waits: number[] = [];
    const provider = createLibraryOfCongressProvider({
      minimumIntervalMs: 3_000,
      now: () => clock,
      wait: async (milliseconds) => {
        waits.push(milliseconds);
        await new Promise<void>((resolve) => (finishWait = resolve));
        clock += milliseconds;
      },
    });
    const fetchImpl = vi.fn(
      async () =>
        await new Promise<Response>((resolve) => {
          finishFirst = () => resolve(response({}, 429, { 'retry-after': '10' }));
        }),
    ) as unknown as typeof fetch;

    const first = provider.search(query, fetchImpl);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    const queued = provider.search(query, fetchImpl);
    await vi.waitFor(() => expect(waits).toEqual([3_000]));

    finishFirst();
    await expect(first).rejects.toThrow(/rate-limited/iu);
    finishWait();
    await expect(queued).rejects.toThrow(/wait before another/iu);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fails closed on HTML or unfamiliar records', async () => {
    const provider = createLibraryOfCongressProvider({ minimumIntervalMs: 0 });
    const htmlFetch = vi.fn(
      async () => new Response('<html>captcha</html>'),
    ) as unknown as typeof fetch;
    await expect(provider.search(query, htmlFetch)).rejects.toThrow(/non-JSON/iu);

    const drifted = createLibraryOfCongressProvider({ minimumIntervalMs: 0 });
    const driftedFetch = vi.fn(async () => response({ items: [] })) as unknown as typeof fetch;
    await expect(drifted.search(query, driftedFetch)).rejects.toThrow(/unfamiliar/iu);
  });

  it('aborts its in-flight catalog request when the research timeout expires', async () => {
    const provider = createLibraryOfCongressProvider({ minimumIntervalMs: 0 });
    let aborted = false;
    const fetchImpl = ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('Aborted', 'AbortError'));
        });
      })) as typeof fetch;

    await expect(
      withAbortingFetchTimeout(fetchImpl, 10, 'Library of Congress timed out.', (scopedFetch) =>
        provider.search(query, scopedFetch),
      ),
    ).rejects.toThrow(/timed out/iu);
    expect(aborted).toBe(true);
  });
});
