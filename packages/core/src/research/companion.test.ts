import { describe, expect, it } from 'vitest';

import { CompanionFetchError, createCompanionResearchClient } from './companion.js';
import type { ResearchQuery } from './types.js';

const query: ResearchQuery = { objectiveTitle: 'Configure Entra ID', terms: ['entra'], topicTitle: 'AZ-104' };

const page = {
  fetchedAt: '2026-07-21T00:00:00.000Z',
  finalUrl: 'https://example.org/attention',
  text: 'Attention lets each token weigh the other tokens in its context.',
  title: 'Attention in transformers',
  truncated: false,
};

function client(fetchImpl: typeof fetch) {
  return createCompanionResearchClient({ baseUrl: 'http://127.0.0.1:8000/', fetchImpl, token: 'secret' });
}

describe('createCompanionResearchClient', () => {
  it('POSTs the URL with the bearer token and parses the fetched page', async () => {
    let captured: { init?: RequestInit; input?: string } = {};
    const result = await client((async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = { init, input: String(input) };
      return Response.json(page);
    }) as unknown as typeof fetch).fetchPage('https://example.org/attention');
    expect(result).toEqual(page);
    expect(captured.input).toBe('http://127.0.0.1:8000/api/research/fetch');
    expect(captured.init?.method).toBe('POST');
    expect(new Headers(captured.init?.headers).get('authorization')).toBe('Bearer secret');
    expect(JSON.parse(String(captured.init?.body))).toEqual({ url: 'https://example.org/attention' });
  });

  it('surfaces companion failure sentences and reasons as CompanionFetchError', async () => {
    const failing = client((async () =>
      Response.json(
        { error: "This address points at a private network and won't be fetched. Paste the text instead.", reason: 'blocked-host' },
        { status: 400 },
      )) as unknown as typeof fetch);
    await expect(failing.fetchPage('http://10.0.0.5/')).rejects.toMatchObject({
      message: "This address points at a private network and won't be fetched. Paste the text instead.",
      reason: 'blocked-host',
    });
    const dead = client((async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch);
    await expect(dead.fetchPage('https://example.org/')).rejects.toBeInstanceOf(CompanionFetchError);
  });

  it('maps ranked search results into descending-score mslearn candidates', async () => {
    const results = await client((async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        'http://127.0.0.1:8000/api/research/mslearn-search?q=Configure%20Entra%20ID',
      );
      return Response.json({
        results: [
          { summary: 'First summary.', title: 'First', url: 'https://learn.microsoft.com/en-us/first' },
          { summary: 'Second summary.', title: 'Second', url: 'https://learn.microsoft.com/en-us/second' },
        ],
      });
    }) as unknown as typeof fetch).searchMsLearnRanked(query);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      key: 'mslearn:https://learn.microsoft.com/en-us/first',
      provider: 'mslearn',
      score: 2,
      snippet: 'First summary.',
      title: 'First',
      url: 'https://learn.microsoft.com/en-us/first',
    });
    expect(results[1].score).toBe(1);
  });
});
