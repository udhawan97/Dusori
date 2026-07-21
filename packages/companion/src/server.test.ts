import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createServer } from './server.js';

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
    expect(allowed.json()).toMatchObject({ version: '0.2.0' });
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
});
