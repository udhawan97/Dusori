import { describe, expect, it, vi } from 'vitest';

import fixture from './__fixtures__/mslearn-catalog.json';
import { createMsLearnProvider, msLearnProvider } from './mslearn.js';

const query = {
  objectiveTitle: 'Configure Microsoft Entra ID',
  searchText: 'Azure administration Configure Microsoft Entra ID',
  terms: ['configure', 'microsoft', 'entra', 'id', 'azure', 'administration'],
  topicTitle: 'Azure administration',
};

function fixtureFetch(): typeof fetch {
  return vi.fn(async () =>
    Promise.resolve(
      new Response(JSON.stringify(fixture), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    ),
  ) as unknown as typeof fetch;
}

describe('Microsoft Learn research provider', () => {
  it('parses, scores, and session-caches the real catalog fixture', async () => {
    const fetchImpl = fixtureFetch();
    const first = await msLearnProvider.search(query, fetchImpl);
    const second = await msLearnProvider.search(query, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('https://learn.microsoft.com/api/catalog/?type=modules');
    expect(second).toEqual(first);
    expect(first.map((candidate) => candidate.key)).toEqual([
      'mslearn:learn.secure-azure-openai-authentication-authorization',
      'mslearn:learn.wwl.secure-mysql',
      'mslearn:learn.dpu.azure-local',
    ]);
    expect(first[0]).toMatchObject({
      meta: { duration_in_minutes: '23', levels: 'beginner', products: 'azure' },
      provider: 'mslearn',
      score: 10,
    });
  });

  it('captures an honest catalog reference without fetching the module page', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-21T10:00:00.000Z'));
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const [candidate] = await msLearnProvider.search(query, fixtureFetch());
    const capture = await msLearnProvider.capture(candidate!, fetchImpl);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(capture.content).toContain('# Secure authentication and authorization');
    expect(capture.content).toContain('- Duration: 23 minutes');
    expect(capture.content).toContain(
      'This is a Microsoft Learn catalog reference captured on 2026-07-21, not a snapshot of the module page.',
    );
    vi.useRealTimers();
  });
});

describe('createMsLearnProvider ranked path', () => {
  const rankedCandidate = {
    key: 'mslearn:https://learn.microsoft.com/en-us/ranked',
    meta: {},
    provider: 'mslearn' as const,
    score: 1,
    snippet: 'Ranked summary.',
    title: 'Ranked module',
    url: 'https://learn.microsoft.com/en-us/ranked',
  };

  it('uses the ranked search when provided and never touches the catalog', async () => {
    let catalogCalls = 0;
    const provider = createMsLearnProvider({ ranked: async () => [rankedCandidate] });
    const results = await provider.search(query, (async () => {
      catalogCalls += 1;
      return Response.json({ modules: [] });
    }) as unknown as typeof fetch);
    expect(results).toEqual([rankedCandidate]);
    expect(catalogCalls).toBe(0);
  });

  it('falls back to catalog scoring when the ranked search fails or is empty', async () => {
    // The catalog fetch caches its result in a module-level variable (see
    // `readCatalog`), and earlier tests in this file already warm that cache
    // with the shared fixture. Reset modules and re-import so each iteration
    // starts from a clean cache and actually exercises the fetchImpl below,
    // instead of silently observing the fixture cached by another test.
    for (const ranked of [async () => Promise.reject(new Error('down')), async () => []]) {
      vi.resetModules();
      const { createMsLearnProvider: freshCreateMsLearnProvider } = await import('./mslearn.js');
      const provider = freshCreateMsLearnProvider({ ranked });
      const results = await provider.search(query, (async () =>
        Response.json({
          modules: [
            {
              popularity: 0.5,
              summary: 'Configure identity.',
              title: 'Configure Microsoft Entra ID',
              uid: 'learn.entra',
              url: 'https://learn.microsoft.com/en-us/training/modules/entra',
            },
          ],
        })) as unknown as typeof fetch);
      expect(results).toHaveLength(1);
      expect(results[0]!.key).toBe('mslearn:learn.entra');
    }
  });

  it('captures ranked candidates without a bogus module UID line', async () => {
    const provider = createMsLearnProvider();
    const capture = await provider.capture(rankedCandidate, fetch);
    expect(capture.content).not.toContain('Module UID: https://');
    expect(capture.content).toContain('# Ranked module');
    expect(capture.content).toContain('Original URL: <https://learn.microsoft.com/en-us/ranked>');
  });
});
