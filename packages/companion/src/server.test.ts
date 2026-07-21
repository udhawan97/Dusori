import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createServer } from './server.js';
import type { LookupImpl } from './research-fetch.js';

const token = 'test-token';
const origin = 'https://udhawan97.github.io';
const servers: Array<Awaited<ReturnType<typeof createServer>>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dusori-root-'));
  const outside = await mkdtemp(join(tmpdir(), 'dusori-outside-'));
  await writeFile(join(root, 'Home.md'), '# Home\n');
  const server = await createServer({ root, token, staticDirectory: join(root, 'missing') });
  servers.push(server);
  return { outside, root, server };
}

function headers(value = token, requestOrigin = origin) {
  return { authorization: `Bearer ${value}`, origin: requestOrigin };
}

describe('companion boundary', () => {
  it('requires the per-launch token and exact allowed origin', async () => {
    const { server } = await fixture();
    expect((await server.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(401);
    expect(
      (
        await server.inject({
          method: 'GET',
          url: '/api/health',
          headers: headers('wrong'),
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await server.inject({
          method: 'GET',
          url: '/api/health',
          headers: headers(token, 'https://evil.example'),
        })
      ).statusCode,
    ).toBe(403);
    const allowed = await server.inject({ method: 'GET', url: '/api/health', headers: headers() });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toMatchObject({
      apiVersion: 1,
      service: 'dusori-companion',
      version: '0.3.0',
    });
    expect(allowed.headers['access-control-allow-origin']).toBe(origin);

    const preflight = await server.inject({
      method: 'OPTIONS',
      url: '/api/health',
      headers: {
        origin,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(origin);
  });

  it('rejects parent, absolute, and symlink escapes', async () => {
    const { outside, root, server } = await fixture();
    await mkdir(join(outside, 'secret'));
    await writeFile(join(outside, 'secret', 'note.md'), 'private');
    await symlink(join(outside, 'secret'), join(root, 'escape'));

    for (const path of ['../outside.md', '/etc/passwd', 'escape/note.md']) {
      const response = await server.inject({
        method: 'GET',
        url: `/api/workspace/file?path=${encodeURIComponent(path)}`,
        headers: headers(),
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it('performs a root-confined conditional write', async () => {
    const { server } = await fixture();
    const response = await server.inject({
      method: 'POST',
      url: '/api/workspace/file',
      headers: { ...headers(), 'content-type': 'application/json' },
      payload: { path: 'Topics/test/Notes/one.md', content: '# One\n', expectedHash: null },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().content).toBe('# One\n');
  });

  it('binds only to the loopback host when launched', async () => {
    const { server } = await fixture();
    await server.listen({ host: '127.0.0.1', port: 0 });
    const address = server.server.address();
    expect(typeof address === 'object' && address?.address).toBe('127.0.0.1');
  });

  it('guards the research routes with the same token and origin rules', async () => {
    const { server } = await fixture();
    expect(
      (
        await server.inject({
          method: 'POST',
          url: '/api/research/fetch',
          payload: { url: 'https://example.org/' },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await server.inject({
          method: 'GET',
          url: '/api/research/mslearn-search?q=entra',
          headers: headers(token, 'https://evil.example'),
        })
      ).statusCode,
    ).toBe(403);
  });

  it('fetches, extracts, and reports typed failures on /api/research/fetch', async () => {
    const html = await readFile(new URL('./__fixtures__/article.html', import.meta.url), 'utf8');
    const publicLookup: LookupImpl = async () => [{ address: '93.184.215.14', family: 4 }];
    const root = await mkdtemp(join(tmpdir(), 'dusori-root-'));
    const server = await createServer({
      research: {
        fetchImpl: (async () =>
          new Response(html, {
            headers: { 'content-type': 'text/html' },
          })) as unknown as typeof fetch,
        lookupImpl: publicLookup,
      },
      root,
      staticDirectory: join(root, 'missing'),
      token,
    });
    servers.push(server);

    const ok = await server.inject({
      method: 'POST',
      url: '/api/research/fetch',
      headers: { ...headers(), 'content-type': 'application/json' },
      payload: { url: 'https://example.org/attention' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      finalUrl: 'https://example.org/attention',
      truncated: false,
    });
    expect(ok.json().text).toContain('weigh the other tokens');

    const blocked = await server.inject({
      method: 'POST',
      url: '/api/research/fetch',
      headers: { ...headers(), 'content-type': 'application/json' },
      payload: { url: 'http://127.0.0.1/admin' },
    });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json()).toMatchObject({ reason: 'blocked-host' });
  });

  it('proxies ranked Microsoft Learn search behind the token', async () => {
    const body = await readFile(
      new URL('./__fixtures__/mslearn-search.json', import.meta.url),
      'utf8',
    );
    const root = await mkdtemp(join(tmpdir(), 'dusori-root-'));
    const server = await createServer({
      research: {
        fetchImpl: (async () =>
          new Response(body, {
            headers: { 'content-type': 'application/json' },
          })) as unknown as typeof fetch,
      },
      root,
      staticDirectory: join(root, 'missing'),
      token,
    });
    servers.push(server);
    const response = await server.inject({
      method: 'GET',
      url: '/api/research/mslearn-search?q=entra%20id',
      headers: headers(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().results.length).toBeGreaterThan(0);
    expect(response.json().results[0]).toHaveProperty('title');
    expect(response.json().results[0]).toHaveProperty('url');
    expect(response.json().results[0]).toHaveProperty('summary');
  });

  it('rejects a malformed research/fetch body cleanly instead of leaking a stack trace', async () => {
    const { server } = await fixture();
    const response = await server.inject({
      method: 'POST',
      url: '/api/research/fetch',
      headers: { ...headers(), 'content-type': 'application/json' },
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).not.toHaveProperty('stack');
    expect(typeof response.json().error).toBe('string');
  });

  it('rejects a missing mslearn-search query param cleanly instead of leaking a stack trace', async () => {
    const { server } = await fixture();
    const response = await server.inject({
      method: 'GET',
      url: '/api/research/mslearn-search',
      headers: headers(),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).not.toHaveProperty('stack');
    expect(typeof response.json().error).toBe('string');
  });

  it('converts unexpected errors in /api/research/fetch to a 500 without leaking detail', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dusori-root-'));
    const badLookup: LookupImpl = async () => {
      // Return a non-array to trigger TypeError when assertPublicHost tries to access .length
      return { not: 'an array' } as any;
    };
    const server = await createServer({
      research: { lookupImpl: badLookup },
      root,
      staticDirectory: join(root, 'missing'),
      token,
    });
    servers.push(server);

    const response = await server.inject({
      method: 'POST',
      url: '/api/research/fetch',
      headers: { ...headers(), 'content-type': 'application/json' },
      payload: { url: 'https://example.org/' },
    });
    expect(response.statusCode).toBe(500);
    expect(JSON.stringify(response.json())).not.toContain('array');
    expect(typeof response.json().error).toBe('string');
    expect(response.json().reason).toBe('fetch-failed');
  });
});
