import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MsLearnProxyError, searchMsLearnRanked } from './research-mslearn.js';

async function fixture(): Promise<string> {
  return readFile(join(import.meta.dirname, '__fixtures__', 'mslearn-search.json'), 'utf8');
}

describe('searchMsLearnRanked', () => {
  it('parses the ranked search response leniently and trims the results', async () => {
    const body = await fixture();
    let requested = '';
    const results = await searchMsLearnRanked('entra id', (async (
      input: string | URL | Request,
    ) => {
      requested = String(input);
      return new Response(body, { headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch);
    expect(requested).toContain('https://learn.microsoft.com/api/search?');
    expect(requested).toContain('search=entra+id');
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(8);
    for (const result of results) {
      expect(result.title).toBeTruthy();
      expect(result.url.startsWith('https://learn.microsoft.com/')).toBe(true);
      expect(typeof result.summary).toBe('string');
    }
  });

  it('throws MsLearnProxyError on upstream failure and unfamiliar shapes', async () => {
    await expect(
      searchMsLearnRanked(
        'x',
        (async () => new Response('down', { status: 503 })) as unknown as typeof fetch,
      ),
    ).rejects.toBeInstanceOf(MsLearnProxyError);
    await expect(
      searchMsLearnRanked('x', (async () =>
        Response.json({ unexpected: true })) as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(MsLearnProxyError);
  });

  it('tolerates a null description instead of rejecting the whole response', async () => {
    const body = {
      results: [
        { title: 'Has null description', url: 'https://learn.microsoft.com/a', description: null },
        { title: 'Has description', url: 'https://learn.microsoft.com/b', description: 'ok' },
      ],
    };
    const results = await searchMsLearnRanked('x', (async () =>
      Response.json(body)) as unknown as typeof fetch);
    expect(results).toHaveLength(2);
    expect(results[0]?.summary).toBe('');
    expect(results[1]?.summary).toBe('ok');
  });

  it('drops a result whose url is protocol-relative to another host', async () => {
    const body = {
      results: [
        { title: 'Evil', url: '//attacker.example/x' },
        { title: 'Good', url: 'https://learn.microsoft.com/b' },
      ],
    };
    const results = await searchMsLearnRanked('x', (async () =>
      Response.json(body)) as unknown as typeof fetch);
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe('Good');
  });

  it('drops a result whose url is absolute and off-host', async () => {
    const body = {
      results: [
        { title: 'Evil', url: 'https://attacker.example/x' },
        { title: 'Good', url: 'https://learn.microsoft.com/b' },
      ],
    };
    const results = await searchMsLearnRanked('x', (async () =>
      Response.json(body)) as unknown as typeof fetch);
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe('Good');
  });

  it('throws MsLearnProxyError when fetch itself fails', async () => {
    await expect(
      searchMsLearnRanked('x', (async () => {
        throw new Error('network down');
      }) as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(MsLearnProxyError);
  });

  it('throws MsLearnProxyError on a non-JSON response body', async () => {
    await expect(
      searchMsLearnRanked(
        'x',
        (async () =>
          new Response('not json', {
            headers: { 'content-type': 'text/plain' },
          })) as unknown as typeof fetch,
      ),
    ).rejects.toBeInstanceOf(MsLearnProxyError);
  });
});
