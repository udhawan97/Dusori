import { describe, expect, it, vi } from 'vitest';

import { maxSourceBytes } from '../../sources/import.js';
import extractFixture from './__fixtures__/wikipedia-extract.json';
import searchFixture from './__fixtures__/wikipedia-search.json';
import { wikipediaProvider } from './wikipedia.js';

const query = {
  objectiveTitle: 'Configure Microsoft Entra ID',
  searchText: 'Azure administration Configure Microsoft Entra ID',
  terms: ['configure', 'microsoft', 'entra', 'id', 'azure', 'administration'],
  topicTitle: 'Azure administration',
};

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  });
}

describe('Wikipedia research provider', () => {
  it('parses ranked search results and captures a full plain-text extract', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) =>
      Promise.resolve(
        response(String(input).includes('list=search') ? searchFixture : extractFixture),
      ),
    );
    const fetchImpl = fetchMock as unknown as typeof fetch;

    const results = await wikipediaProvider.search(query, fetchImpl);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      key: 'wikipedia:44779164',
      meta: { size: '8948', wordcount: '746' },
      provider: 'wikipedia',
      score: 2,
      snippet:
        'Microsoft Entra Connect is a tool for connecting on-premises identity infrastructure to Microsoft Entra ID.',
      url: 'https://en.wikipedia.org/?curid=44779164',
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      'srsearch=Azure+administration+Configure+Microsoft+Entra+ID',
    );

    const capture = await wikipediaProvider.capture(results[0]!, fetchImpl);
    expect(capture.content).toBe(
      `# Microsoft Entra Connect\n\nOriginal URL: <https://en.wikipedia.org/?curid=44779164>\n\n${extractFixture.query.pages['44779164'].extract}\n`,
    );
  });

  it('truncates extracts below the source cap and marks the saved content', async () => {
    const fetchImpl = vi.fn(async () =>
      Promise.resolve(
        response({
          query: {
            pages: {
              '44779164': {
                extract: 'é'.repeat(maxSourceBytes),
                pageid: 44779164,
                title: 'Microsoft Entra Connect',
              },
            },
          },
        }),
      ),
    ) as unknown as typeof fetch;
    const candidate = {
      key: 'wikipedia:44779164',
      meta: {},
      provider: 'wikipedia' as const,
      score: 1,
      snippet: '',
      title: 'Microsoft Entra Connect',
      url: 'https://en.wikipedia.org/?curid=44779164',
    };

    const capture = await wikipediaProvider.capture(candidate, fetchImpl);
    expect(new TextEncoder().encode(capture.content).byteLength).toBeLessThanOrEqual(
      maxSourceBytes,
    );
    expect(capture.content).toMatch(/\n\n\[truncated\]\n$/u);
  });
});
