import { describe, expect, it } from 'vitest';

import { applyAiRerank, createCompanionAiClient } from './ai.js';
import { buildResearchQuery } from './plan.js';
import type { RankedCandidate } from './rank.js';

const query = buildResearchQuery('TypeScript', { title: 'Understand generics' });

function ranked(key: string, rankScore: number): RankedCandidate {
  return {
    isNew: false,
    key,
    meta: {},
    provider: 'test',
    rankScore,
    reasons: [],
    score: 1,
    snippet: 'snippet',
    title: key,
    url: `https://example.com/${key}`,
  };
}

function client(fetchImpl: typeof fetch) {
  return createCompanionAiClient({ baseUrl: 'http://127.0.0.1:4173', fetchImpl, token: 't' });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
}

describe('CompanionAiClient', () => {
  it('reads capabilities and treats failure as no AI', async () => {
    const capable = client((async () =>
      jsonResponse({ providers: [{ id: 'ollama', model: 'gemma3:4b' }] })) as typeof fetch);
    expect(await capable.capabilities()).toEqual([{ id: 'ollama', model: 'gemma3:4b' }]);

    const down = client((async () => {
      throw new Error('offline');
    }) as typeof fetch);
    expect(await down.capabilities()).toEqual([]);
  });

  it('sends candidate metadata only and parses the verdict', async () => {
    let sent = '';
    const aiClient = client((async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent = String(init?.body);
      return jsonResponse({ results: [{ aiScore: 0.9, key: 'a', note: 'Reliable' }] });
    }) as typeof fetch);

    const verdict = await aiClient.rerank(query, [ranked('a', 0.5)]);

    expect(verdict).toEqual([{ aiScore: 0.9, key: 'a', note: 'Reliable' }]);
    expect(sent).toContain('"query"');
    expect(sent).not.toContain('rankScore');
    expect(sent).not.toContain('reasons');
  });

  it('raises a typed failure when the rerank answer is unfamiliar', async () => {
    const aiClient = client((async () => jsonResponse({ nope: true })) as typeof fetch);
    await expect(aiClient.rerank(query, [ranked('a', 0.5)])).rejects.toMatchObject({
      reason: 'ai-failed',
    });
  });

  it('returns the brief text the companion produced', async () => {
    const aiClient = client((async () =>
      jsonResponse({ brief: '## Reading order\n\nStart here.' })) as typeof fetch);
    const brief = await aiClient.writeBrief(query, [
      { providerLabel: 'GitHub', reasons: [], title: 'T', url: 'https://a' },
    ]);
    expect(brief).toContain('Reading order');
  });
});

describe('applyAiRerank', () => {
  it('reorders by AI score and attaches notes without dropping anyone', () => {
    const result = applyAiRerank(
      [ranked('a', 0.9), ranked('b', 0.5), ranked('c', 0.3)],
      [
        { aiScore: 0.2, key: 'a', note: 'Outdated approach' },
        { aiScore: 0.95, key: 'b', note: 'Best fit' },
      ],
    );

    expect(result.map((candidate) => candidate.key)).toEqual(['b', 'a', 'c']);
    expect(result[0]?.aiNote).toBe('Best fit');
    expect(result[2]?.aiNote).toBeUndefined();
    expect(result).toHaveLength(3);
  });

  it('keeps deterministic order among candidates the AI did not score', () => {
    const result = applyAiRerank([ranked('a', 0.9), ranked('b', 0.5)], []);
    expect(result.map((candidate) => candidate.key)).toEqual(['a', 'b']);
  });
});
