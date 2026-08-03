import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createServer } from './server.js';
import { companionVersion } from './version.js';
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
      version: companionVersion,
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
    expect(
      (await server.inject({ method: 'GET', url: '/api/research/arxiv?q=attention' })).statusCode,
    ).toBe(401);
    expect(
      (await server.inject({ method: 'GET', url: '/api/research/web-search?q=entra' })).statusCode,
    ).toBe(401);
    expect(
      (
        await server.inject({
          method: 'GET',
          url: '/api/research/arxiv?q=attention',
          headers: headers(token, 'https://evil.example'),
        })
      ).statusCode,
    ).toBe(403);
  });

  it('proxies arXiv search behind the token and reports upstream failure as 502', async () => {
    const body = await readFile(
      new URL('./__fixtures__/arxiv-search.xml', import.meta.url),
      'utf8',
    );
    const root = await mkdtemp(join(tmpdir(), 'dusori-root-'));
    const server = await createServer({
      research: {
        fetchImpl: (async () =>
          new Response(body, {
            headers: { 'content-type': 'application/atom+xml' },
          })) as unknown as typeof fetch,
      },
      root,
      staticDirectory: join(root, 'missing'),
      token,
    });
    servers.push(server);

    const ok = await server.inject({
      method: 'GET',
      url: '/api/research/arxiv?q=attention',
      headers: headers(),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().results.length).toBeGreaterThan(0);
    expect(ok.json().results[0]).toMatchObject({
      title: expect.any(String),
      url: expect.any(String),
    });

    const missingQuery = await server.inject({
      method: 'GET',
      url: '/api/research/arxiv',
      headers: headers(),
    });
    expect(missingQuery.statusCode).toBe(400);

    const failing = await createServer({
      research: {
        fetchImpl: (async () => new Response('down', { status: 503 })) as unknown as typeof fetch,
      },
      root,
      staticDirectory: join(root, 'missing'),
      token,
    });
    servers.push(failing);
    const upstreamDown = await failing.inject({
      method: 'GET',
      url: '/api/research/arxiv?q=attention',
      headers: headers(),
    });
    expect(upstreamDown.statusCode).toBe(502);
    expect(upstreamDown.json().reason).toBe('fetch-failed');
  });

  it('answers /api/research/web-search with 503 when no provider env var is set', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dusori-root-'));
    const server = await createServer({
      research: { env: {} },
      root,
      staticDirectory: join(root, 'missing'),
      token,
    });
    servers.push(server);

    const response = await server.inject({
      method: 'GET',
      url: '/api/research/web-search?q=entra',
      headers: headers(),
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().reason).toBe('not-configured');
    expect(response.json().error).toContain('BRAVE_API_KEY');
    expect(response.json().error).toContain('TAVILY_API_KEY');
    expect(response.json().error).toContain('SEARXNG_URL');

    const missingQuery = await server.inject({
      method: 'GET',
      url: '/api/research/web-search',
      headers: headers(),
    });
    expect(missingQuery.statusCode).toBe(400);
  });

  it('proxies web search through the configured provider without echoing the key', async () => {
    const apiKey = 'super-secret-brave-key';
    const root = await mkdtemp(join(tmpdir(), 'dusori-root-'));
    const server = await createServer({
      research: {
        env: { BRAVE_API_KEY: apiKey },
        fetchImpl: (async () =>
          Response.json({
            web: {
              results: [
                { description: 'A summary', title: 'A result', url: 'https://example.org/a' },
              ],
            },
          })) as unknown as typeof fetch,
      },
      root,
      staticDirectory: join(root, 'missing'),
      token,
    });
    servers.push(server);

    const ok = await server.inject({
      method: 'GET',
      url: '/api/research/web-search?q=entra%20id',
      headers: headers(),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().results).toEqual([
      { summary: 'A summary', title: 'A result', url: 'https://example.org/a' },
    ]);
    expect(ok.body).not.toContain(apiKey);

    const failing = await createServer({
      research: {
        env: { BRAVE_API_KEY: apiKey },
        fetchImpl: (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch,
      },
      root,
      staticDirectory: join(root, 'missing'),
      token,
    });
    servers.push(failing);
    const upstreamDown = await failing.inject({
      method: 'GET',
      url: '/api/research/web-search?q=entra',
      headers: headers(),
    });
    expect(upstreamDown.statusCode).toBe(502);
    expect(upstreamDown.json().reason).toBe('fetch-failed');
    expect(upstreamDown.body).not.toContain(apiKey);
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

describe('youtube routes', () => {
  const searchBody = [
    {
      author: 'Computerphile',
      description: 'How attention works.',
      lengthSeconds: 934,
      title: 'How attention works',
      videoId: 'dQw4w9WgXcQ',
      viewCount: 1_200_000,
    },
  ];

  async function youtubeServer(fetchImpl: typeof fetch) {
    const root = await mkdtemp(join(tmpdir(), 'dusori-root-'));
    const server = await createServer({
      research: { env: { INVIDIOUS_URL: 'https://yewtu.example' }, fetchImpl },
      root,
      staticDirectory: join(root, 'missing'),
      token,
    });
    servers.push(server);
    return server;
  }

  it('gates the video routes and rejects an id that is not a video id', async () => {
    const { server } = await fixture();
    for (const url of [
      '/api/research/youtube?q=a',
      '/api/research/youtube-transcript?id=dQw4w9WgXcQ',
      '/api/research/youtube-thumbnail?id=dQw4w9WgXcQ',
    ]) {
      expect((await server.inject({ method: 'GET', url })).statusCode).toBe(401);
    }

    const traversal = await server.inject({
      headers: headers(),
      method: 'GET',
      url: '/api/research/youtube-thumbnail?id=../../etc/passwd',
    });
    expect(traversal.statusCode).toBe(400);
    expect(traversal.json().reason).toBe('invalid-id');
  });

  it('returns most-viewed videos and proxies the thumbnail as image bytes', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      seen.push(url);
      if (url.includes('/vi/')) {
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { 'Content-Type': 'image/png' },
          status: 200,
        });
      }
      return new Response(JSON.stringify(searchBody), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      });
    }) as typeof fetch;
    const server = await youtubeServer(fetchImpl);

    const search = await server.inject({
      headers: headers(),
      method: 'GET',
      url: '/api/research/youtube?q=attention',
    });
    expect(search.statusCode).toBe(200);
    expect(search.json().results[0]).toMatchObject({
      id: 'dQw4w9WgXcQ',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      viewCount: 1_200_000,
    });

    const thumbnail = await server.inject({
      headers: headers(),
      method: 'GET',
      url: '/api/research/youtube-thumbnail?id=dQw4w9WgXcQ',
    });
    expect(thumbnail.statusCode).toBe(200);
    expect(thumbnail.headers['content-type']).toBe('image/png');
    expect(thumbnail.rawPayload.length).toBe(4);
    // Only the configured instance is ever contacted: no youtube.com, no ytimg.com.
    expect(seen.every((url) => url.startsWith('https://yewtu.example/'))).toBe(true);
  });

  it('reports a missing instance and a video without captions', async () => {
    const { server } = await fixture();
    const unconfigured = await server.inject({
      headers: headers(),
      method: 'GET',
      url: '/api/research/youtube?q=attention',
    });
    expect(unconfigured.statusCode).toBe(503);
    expect(unconfigured.json().reason).toBe('not-configured');

    const captionless = await youtubeServer(
      (async () =>
        new Response(JSON.stringify({ captions: [] }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        })) as typeof fetch,
    );
    const response = await captionless.inject({
      headers: headers(),
      method: 'GET',
      url: '/api/research/youtube-transcript?id=dQw4w9WgXcQ',
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().reason).toBe('no-captions');
  });
});

describe('ai routes', () => {
  it('gates every AI route behind the token', async () => {
    const { server } = await fixture();
    for (const [method, url] of [
      ['GET', '/api/ai/capabilities'],
      ['POST', '/api/ai/rerank'],
      ['POST', '/api/ai/brief'],
      ['POST', '/api/ai/synthesize'],
      ['POST', '/api/ai/recall-prompts'],
    ] as const) {
      expect((await server.inject({ method, url })).statusCode).toBe(401);
    }
  });

  it('rewrites review prompts and rejects a payload beyond the disclosed shape', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dusori-root-'));
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ response: '["Recall one","Recall two"]' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      })) as unknown as typeof fetch;
    const server = await createServer({
      ai: { env: { OLLAMA_MODEL: 'gemma3:4b' }, fetchImpl },
      root,
      staticDirectory: join(root, 'missing'),
      token,
    });
    servers.push(server);

    const rewritten = await server.inject({
      headers: headers(),
      method: 'POST',
      payload: {
        excerpts: [
          { excerpt: 'Attention weighs tokens.', heading: 'Attention', title: 'Notes' },
          { excerpt: 'Positions are added back.', heading: 'Positions', title: 'Notes' },
        ],
        objective: 'Describe attention',
      },
      url: '/api/ai/recall-prompts',
    });
    expect(rewritten.statusCode).toBe(200);
    expect(rewritten.json()).toEqual({ prompts: ['Recall one', 'Recall two'] });

    const rejected = await server.inject({
      headers: headers(),
      method: 'POST',
      payload: { excerpts: [], notes: 'my private note', objective: 'Describe attention' },
      url: '/api/ai/recall-prompts',
    });
    expect(rejected.statusCode).toBe(400);
  });

  it('reports an unconfigured provider when asked for review prompts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dusori-root-'));
    const server = await createServer({
      ai: { env: {} },
      root,
      staticDirectory: join(root, 'missing'),
      token,
    });
    servers.push(server);

    const response = await server.inject({
      headers: headers(),
      method: 'POST',
      payload: {
        excerpts: [{ excerpt: 'Attention weighs tokens.', heading: 'Attention', title: 'Notes' }],
        objective: 'Describe attention',
      },
      url: '/api/ai/recall-prompts',
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().reason).toBe('not-configured');
  });

  it('reports no providers when nothing is configured', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dusori-root-'));
    const server = await createServer({
      ai: { env: {} },
      root,
      staticDirectory: join(root, 'missing'),
      token,
    });
    servers.push(server);
    const response = await server.inject({
      headers: headers(),
      method: 'GET',
      url: '/api/ai/capabilities',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ providers: [] });

    const rerank = await server.inject({
      headers: headers(),
      method: 'POST',
      payload: {
        candidates: [{ key: 'a', snippet: 's', title: 't', url: 'https://a' }],
        query: 'q',
      },
      url: '/api/ai/rerank',
    });
    expect(rerank.statusCode).toBe(503);
    expect(rerank.json().reason).toBe('not-configured');
  });

  it('reranks through the configured provider and never leaks the key', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dusori-root-'));
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '[{"key":"a","score":0.8,"note":"Solid"}]' } }],
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 },
      )) as unknown as typeof fetch;
    const server = await createServer({
      ai: { env: { OPENAI_API_KEY: 'sk-secret-key' }, fetchImpl },
      root,
      staticDirectory: join(root, 'missing'),
      token,
    });
    servers.push(server);

    const capabilities = await server.inject({
      headers: headers(),
      method: 'GET',
      url: '/api/ai/capabilities',
    });
    expect(capabilities.json()).toEqual({ providers: [{ id: 'openai', model: 'gpt-4o-mini' }] });
    expect(capabilities.body).not.toContain('sk-secret-key');

    const rerank = await server.inject({
      headers: headers(),
      method: 'POST',
      payload: {
        candidates: [{ key: 'a', snippet: 's', title: 't', url: 'https://a' }],
        query: 'q',
      },
      url: '/api/ai/rerank',
    });
    expect(rerank.statusCode).toBe(200);
    expect(rerank.json()).toEqual({ results: [{ aiScore: 0.8, key: 'a', note: 'Solid' }] });
    expect(rerank.body).not.toContain('sk-secret-key');
  });

  it('writes a brief and surfaces AI failure as a 502 with a friendly message', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dusori-root-'));
    let call = 0;
    const fetchImpl = (async () => {
      call += 1;
      if (call === 1) {
        return new Response(JSON.stringify({ response: '## Reading order\n\nStart here.' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      }
      return new Response('upstream broke', { status: 500 });
    }) as unknown as typeof fetch;
    const server = await createServer({
      ai: { env: { OLLAMA_MODEL: 'gemma3:4b' }, fetchImpl },
      root,
      staticDirectory: join(root, 'missing'),
      token,
    });
    servers.push(server);

    const payload = {
      query: 'q',
      sources: [{ reasons: ['312 points'], title: 'T', url: 'https://a' }],
    };
    const brief = await server.inject({
      headers: headers(),
      method: 'POST',
      payload,
      url: '/api/ai/brief',
    });
    expect(brief.statusCode).toBe(200);
    expect(brief.json().brief).toContain('Reading order');

    const failed = await server.inject({
      headers: headers(),
      method: 'POST',
      payload,
      url: '/api/ai/brief',
    });
    expect(failed.statusCode).toBe(502);
    expect(failed.json().reason).toBe('ai-failed');
  });

  it('writes synthesis prose, caps the passages it accepts, and fails as a 502', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dusori-root-'));
    let call = 0;
    const fetchImpl = (async () => {
      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify({ response: 'Spacing works because retrieval strengthens memory.' }),
          { headers: { 'Content-Type': 'application/json' }, status: 200 },
        );
      }
      return new Response('upstream broke', { status: 500 });
    }) as unknown as typeof fetch;
    const server = await createServer({
      ai: { env: { OLLAMA_MODEL: 'gemma3:4b' }, fetchImpl },
      root,
      staticDirectory: join(root, 'missing'),
      token,
    });
    servers.push(server);

    const payload = {
      claims: [{ heading: 'Forgetting curve', source: 'Spaced repetition', text: 'Reviews help.' }],
      topic: 'Spaced repetition learning',
    };
    const written = await server.inject({
      headers: headers(),
      method: 'POST',
      payload,
      url: '/api/ai/synthesize',
    });
    expect(written.statusCode).toBe(200);
    expect(written.json().overview).toContain('retrieval strengthens memory');

    // The cap is the disclosure: a payload beyond it never reaches the model.
    const oversized = await server.inject({
      headers: headers(),
      method: 'POST',
      payload: {
        claims: Array.from({ length: 61 }, () => ({ source: 'S', text: 'A passage.' })),
        topic: 'T',
      },
      url: '/api/ai/synthesize',
    });
    expect(oversized.statusCode).toBe(400);

    const failed = await server.inject({
      headers: headers(),
      method: 'POST',
      payload,
      url: '/api/ai/synthesize',
    });
    expect(failed.statusCode).toBe(502);
    expect(failed.json().reason).toBe('ai-failed');
  });
});
