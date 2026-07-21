import { describe, expect, it, vi } from 'vitest';

import fixture from './__fixtures__/mslearn-catalog.json';
import { msLearnProvider } from './mslearn.js';

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
