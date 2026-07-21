import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  FetchPageError,
  fetchReadablePage,
  maxFetchBytes,
  type LookupImpl,
} from './research-fetch.js';

const publicLookup: LookupImpl = async () => [{ address: '93.184.215.14', family: 4 }];
const privateLookup: LookupImpl = async () => [{ address: '10.0.0.5', family: 4 }];

function htmlResponse(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  });
}

async function reason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'no-error';
  } catch (error) {
    return error instanceof FetchPageError ? error.reason : 'unexpected';
  }
}

describe('fetchReadablePage', () => {
  it('extracts readable text, title, and byline from an article page', async () => {
    const html = await readFile(join(import.meta.dirname, '__fixtures__', 'article.html'), 'utf8');
    const page = await fetchReadablePage('https://example.org/attention', {
      fetchImpl: async () => htmlResponse(html),
      lookupImpl: publicLookup,
      now: () => new Date('2026-07-21T00:00:00.000Z'),
    });
    expect(page.title).toContain('Attention in transformers');
    expect(page.text).toContain('weigh the other tokens');
    expect(page.text).not.toContain('Subscribe for more');
    expect(page.finalUrl).toBe('https://example.org/attention');
    expect(page.fetchedAt).toBe('2026-07-21T00:00:00.000Z');
    expect(page.truncated).toBe(false);
  });

  it('returns plain text bodies without extraction', async () => {
    const page = await fetchReadablePage('https://example.org/notes.txt', {
      fetchImpl: async () =>
        new Response('plain body text', { headers: { 'content-type': 'text/plain' } }),
      lookupImpl: publicLookup,
    });
    expect(page.text).toBe('plain body text');
    expect(page.title).toBe('notes.txt');
  });

  it('rejects invalid and non-http URLs before any network use', async () => {
    expect(await reason(fetchReadablePage('not a url', { lookupImpl: publicLookup }))).toBe(
      'invalid-url',
    );
    expect(
      await reason(fetchReadablePage('ftp://example.org/x', { lookupImpl: publicLookup })),
    ).toBe('invalid-url');
    expect(
      await reason(fetchReadablePage('https://user:pw@example.org/', { lookupImpl: publicLookup })),
    ).toBe('invalid-url');
  });

  it('blocks private IP literals and privately-resolving hosts without fetching', async () => {
    let fetched = 0;
    const spy = (async () => {
      fetched += 1;
      return htmlResponse('<p>x</p>');
    }) as unknown as typeof fetch;
    expect(
      await reason(
        fetchReadablePage('http://127.0.0.1/admin', { fetchImpl: spy, lookupImpl: publicLookup }),
      ),
    ).toBe('blocked-host');
    expect(
      await reason(
        fetchReadablePage('http://internal.test/', { fetchImpl: spy, lookupImpl: privateLookup }),
      ),
    ).toBe('blocked-host');
    expect(fetched).toBe(0);
  });

  it('re-validates every redirect hop and blocks redirects into private space', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url === 'https://example.org/start') {
        return new Response(null, {
          headers: { location: 'http://internal.test/secret' },
          status: 302,
        });
      }
      return htmlResponse('<p>x</p>');
    }) as unknown as typeof fetch;
    const lookupImpl: LookupImpl = async (hostname) =>
      hostname === 'internal.test'
        ? [{ address: '192.168.0.9', family: 4 }]
        : [{ address: '93.184.215.14', family: 4 }];
    expect(
      await reason(fetchReadablePage('https://example.org/start', { fetchImpl, lookupImpl })),
    ).toBe('blocked-host');
  });

  it('gives up after three redirects', async () => {
    const fetchImpl = (async (input: string | URL | Request) =>
      new Response(null, {
        headers: { location: `${String(input)}0` },
        status: 301,
      })) as unknown as typeof fetch;
    expect(
      await reason(
        fetchReadablePage('https://example.org/r', { fetchImpl, lookupImpl: publicLookup }),
      ),
    ).toBe('too-many-redirects');
  });

  it('rejects unsupported content types and oversized bodies', async () => {
    expect(
      await reason(
        fetchReadablePage('https://example.org/file.pdf', {
          fetchImpl: async () =>
            new Response('x', { headers: { 'content-type': 'application/pdf' } }),
          lookupImpl: publicLookup,
        }),
      ),
    ).toBe('unsupported-type');
    expect(
      await reason(
        fetchReadablePage('https://example.org/huge', {
          fetchImpl: async () => htmlResponse('x', { 'content-length': String(maxFetchBytes + 1) }),
          lookupImpl: publicLookup,
        }),
      ),
    ).toBe('too-large');
    expect(
      await reason(
        fetchReadablePage('https://example.org/stream', {
          fetchImpl: async () => htmlResponse('y'.repeat(maxFetchBytes + 16)),
          lookupImpl: publicLookup,
        }),
      ),
    ).toBe('too-large');
  });

  it('maps HTTP failures and empty extractions to typed reasons', async () => {
    expect(
      await reason(
        fetchReadablePage('https://example.org/missing', {
          fetchImpl: async () => new Response('gone', { status: 404 }),
          lookupImpl: publicLookup,
        }),
      ),
    ).toBe('fetch-failed');
    expect(
      await reason(
        fetchReadablePage('https://example.org/empty', {
          fetchImpl: async () => htmlResponse('<html><body><nav>menu</nav></body></html>'),
          lookupImpl: publicLookup,
        }),
      ),
    ).toBe('extraction-failed');
  });
});
