import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createPinnedLookup,
  FetchPageError,
  fetchReadablePage,
  maxFetchBytes,
  type LookupImpl,
} from './research-fetch.js';

describe('pinned DNS lookup', () => {
  it('returns every validated address when Node requests the all-address shape', async () => {
    const addresses = [
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
      { address: '93.184.215.14', family: 4 },
    ];
    const lookup = createPinnedLookup(addresses);

    const result = await new Promise<unknown>((resolve, reject) => {
      lookup('example.org', { all: true }, (error, value) => {
        if (error) reject(error);
        else resolve(value);
      });
    });

    expect(result).toEqual(addresses);
  });
});

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

  it('rejects a redirect to a different host before contacting it', async () => {
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
    ).toBe('redirect-host');
  });

  it('re-validates a same-host redirect and blocks a private second DNS answer', async () => {
    const fetchImpl = (async () =>
      new Response(null, {
        headers: { location: '/next' },
        status: 302,
      })) as unknown as typeof fetch;
    let calls = 0;
    const lookupImpl: LookupImpl = async () => {
      calls += 1;
      return [
        calls === 1 ? { address: '93.184.215.14', family: 4 } : { address: '127.0.0.1', family: 4 },
      ];
    };
    expect(
      await reason(fetchReadablePage('https://example.org/start', { fetchImpl, lookupImpl })),
    ).toBe('blocked-host');
    expect(calls).toBe(2);
  });

  it('allows a same-origin redirect but rejects a redirect to an unapproved origin', async () => {
    const sameOrigin = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url === 'https://example.org/start') {
        return new Response(null, { headers: { location: '/final.txt' }, status: 302 });
      }
      return new Response('same host text', { headers: { 'content-type': 'text/plain' } });
    }) as unknown as typeof fetch;
    const page = await fetchReadablePage('https://example.org/start', {
      fetchImpl: sameOrigin,
      lookupImpl: publicLookup,
    });
    expect(page.finalUrl).toBe('https://example.org/final.txt');

    const crossOrigin = (async () =>
      new Response(null, {
        headers: { location: 'https://login.example.net/article' },
        status: 302,
      })) as unknown as typeof fetch;
    await expect(
      fetchReadablePage('https://example.org/start', {
        fetchImpl: crossOrigin,
        lookupImpl: publicLookup,
      }),
    ).rejects.toMatchObject({ reason: 'redirect-host' });
  });

  it('pins the production request to every address that passed validation', async () => {
    let dnsAnswer = '93.184.215.14';
    const lookupImpl: LookupImpl = async () => [
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
      { address: dnsAnswer, family: 4 },
    ];
    const seen: Array<Array<{ address: string; family: number }>> = [];
    const page = await fetchReadablePage('https://rebind.example/article.txt', {
      lookupImpl,
      pinnedFetchImpl: async (_url, addresses) => {
        seen.push(addresses);
        // A rebinding resolver would now answer private space, but the request already carries
        // the validated address and never asks DNS again.
        dnsAnswer = '127.0.0.1';
        return new Response('pinned public response', {
          headers: { 'content-type': 'text/plain' },
        });
      },
    });
    expect(seen).toEqual([
      [
        { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
        { address: '93.184.215.14', family: 4 },
      ],
    ]);
    expect(page.text).toBe('pinned public response');
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

  it('reports authentication and rate-limit responses as browser handoffs', async () => {
    for (const status of [401, 403, 429]) {
      await expect(
        fetchReadablePage(`https://example.org/status-${status}`, {
          fetchImpl: async () => new Response('blocked', { status }),
          lookupImpl: publicLookup,
        }),
      ).rejects.toMatchObject({ reason: 'access-denied', status });
    }
  });

  it('cancels rejected and redirected bodies before handing off or following', async () => {
    let cancelled = 0;
    const body = () =>
      new ReadableStream<Uint8Array>({
        cancel() {
          cancelled += 1;
        },
      });
    await reason(
      fetchReadablePage('https://example.org/blocked', {
        fetchImpl: async () => new Response(body(), { status: 401 }),
        lookupImpl: publicLookup,
      }),
    );
    expect(cancelled).toBe(1);

    let calls = 0;
    await fetchReadablePage('https://example.org/start', {
      fetchImpl: async () => {
        calls += 1;
        return calls === 1
          ? new Response(body(), { headers: { location: '/final.txt' }, status: 302 })
          : new Response('readable text', { headers: { 'content-type': 'text/plain' } });
      },
      lookupImpl: publicLookup,
    });
    expect(cancelled).toBe(2);
  });

  it('converts a stalled body stream into a timeout failure, not a raw DOMException', async () => {
    const stalledBody = new ReadableStream<Uint8Array>({
      start() {
        // Never enqueue and never close: simulates a body that stops responding
        // after headers have already arrived.
      },
    });
    let caught: unknown;
    try {
      await fetchReadablePage('https://example.org/slow-drip', {
        fetchImpl: async () =>
          new Response(stalledBody, { headers: { 'content-type': 'text/html' } }),
        lookupImpl: publicLookup,
        timeoutMs: 50,
      });
      expect.fail('expected fetchReadablePage to throw');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FetchPageError);
    expect((caught as FetchPageError).reason).toBe('timeout');
    expect((caught as FetchPageError).message).toBe(
      'This page took longer than 0.05 seconds. Try again, or paste the text instead.',
    );
  });

  it('cancels the body reader on timeout instead of leaving the stream locked', async () => {
    let cancelled = false;
    const stalledBody = new ReadableStream<Uint8Array>({
      start() {
        // Never enqueue and never close, same as the timeout test above.
      },
      cancel() {
        cancelled = true;
      },
    });
    await reason(
      fetchReadablePage('https://example.org/slow-drip-cancel', {
        fetchImpl: async () =>
          new Response(stalledBody, { headers: { 'content-type': 'text/html' } }),
        lookupImpl: publicLookup,
        timeoutMs: 50,
      }),
    );
    expect(cancelled).toBe(true);
  });

  it('wraps a mid-stream connection error as a typed FetchPageError, not a raw exception', async () => {
    const erroringBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('connection reset'));
      },
    });
    let caught: unknown;
    try {
      await fetchReadablePage('https://example.org/connection-reset', {
        fetchImpl: async () =>
          new Response(erroringBody, { headers: { 'content-type': 'text/html' } }),
        lookupImpl: publicLookup,
      });
      expect.fail('expected fetchReadablePage to throw');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FetchPageError);
    expect((caught as FetchPageError).reason).toBe('fetch-failed');
    expect((caught as FetchPageError).message).toBe(
      'This page could not be fetched. Check the URL or your connection.',
    );
  });

  it('rejects genuine short-article text with a message naming its own shortness, not "no text found"', async () => {
    const shortParagraph =
      'This short note is a genuine article body with real sentences, but it does not reach ' +
      'the five hundred character floor that the extractor requires before it will accept the ' +
      'result as a proper article for storage.';
    const shortArticleHtml = `<html><head><title>A Short Note</title></head><body><article><h1>A Short Note</h1><p>${shortParagraph}</p></article></body></html>`;
    let caught: unknown;
    try {
      await fetchReadablePage('https://example.org/short-note', {
        fetchImpl: async () => htmlResponse(shortArticleHtml),
        lookupImpl: publicLookup,
      });
      expect.fail('expected fetchReadablePage to throw');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FetchPageError);
    expect((caught as FetchPageError).reason).toBe('extraction-failed');
    expect((caught as FetchPageError).message).toBe(
      'The readable text on this page was too short to store as a source. Paste the text instead.',
    );
  });
});
