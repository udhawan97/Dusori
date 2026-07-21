import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';

import { StorageConflictError } from '@dusori/core';

import { appBasePath } from '../../../config/site.mjs';

import {
  canonicalRoot,
  listWorkspace,
  readWorkspaceFile,
  writeWorkspaceFile,
} from './filesystem.js';
import { FetchPageError, fetchReadablePage, type LookupImpl } from './research-fetch.js';
import { MsLearnProxyError, searchMsLearnRanked } from './research-mslearn.js';

const WriteBody = z.object({
  path: z.string().min(1),
  content: z.string(),
  expectedHash: z.string().length(64).nullable().optional(),
});

const FetchBody = z.object({ url: z.string().min(1) });
const SearchQuery = z.object({ q: z.string().min(1) });
const badRequestReasons = new Set([
  'blocked-host',
  'invalid-url',
  'too-large',
  'too-many-redirects',
  'unsupported-type',
]);

export interface ServerOptions {
  root?: string;
  staticDirectory?: string;
  token: string;
  hostedOrigin?: string;
  research?: { fetchImpl?: typeof fetch; lookupImpl?: LookupImpl };
}

function bearerToken(header: string | undefined): string | null {
  const match = header?.match(/^Bearer\s+(.+)$/u);
  return match?.[1] ?? null;
}

export async function createServer(options: ServerOptions): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });
  const startedAt = Date.now();
  const root = options.root ? await canonicalRoot(options.root) : null;
  const hostedOrigin = options.hostedOrigin ?? 'https://udhawan97.github.io';

  await server.register(fastifyCors, {
    allowedHeaders: ['Authorization', 'Content-Type'],
    methods: ['GET', 'POST', 'OPTIONS'],
    origin(origin, callback) {
      if (
        !origin ||
        origin === hostedOrigin ||
        /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/u.test(origin)
      ) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
  });

  server.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    const origin = request.headers.origin;
    const ownOrigin = request.headers.host ? `http://${request.headers.host}` : null;
    if (origin && origin !== hostedOrigin && origin !== ownOrigin) {
      await reply.code(403).send({ error: 'Origin is not allowed.' });
      return reply;
    }
    if (bearerToken(request.headers.authorization) !== options.token) {
      await reply.code(401).send({ error: 'A valid session token is required.' });
      return reply;
    }
  });

  server.get('/api/health', async () => ({
    version: '0.2.0',
    uptime: Math.floor((Date.now() - startedAt) / 1000),
  }));

  server.post('/api/session', async () => ({
    authenticated: true,
    rootSelected: Boolean(root),
  }));

  server.get('/api/workspace/list', async (request, reply) => {
    if (!root) return reply.code(400).send({ error: 'Start Dusori with --root <path>.' });
    const query = z.object({ path: z.string().optional() }).parse(request.query);
    try {
      return { entries: await listWorkspace(root, query.path ?? '') };
    } catch (error) {
      return reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : 'Invalid path.' });
    }
  });

  server.get('/api/workspace/file', async (request, reply) => {
    if (!root) return reply.code(400).send({ error: 'Start Dusori with --root <path>.' });
    const query = z.object({ path: z.string().min(1) }).parse(request.query);
    try {
      return await readWorkspaceFile(root, query.path);
    } catch (error) {
      return reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : 'Invalid path.' });
    }
  });

  server.post('/api/workspace/file', async (request, reply) => {
    if (!root) return reply.code(400).send({ error: 'Start Dusori with --root <path>.' });
    const body = WriteBody.parse(request.body);
    try {
      return await writeWorkspaceFile(root, body.path, body.content, body.expectedHash);
    } catch (error) {
      if (error instanceof StorageConflictError) {
        return reply.code(409).send({ error: error.message, actualHash: error.actualHash });
      }
      return reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : 'Invalid path.' });
    }
  });

  server.post('/api/research/fetch', async (request, reply) => {
    const body = FetchBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'A url is required.', reason: 'invalid-url' });
    }
    try {
      return await fetchReadablePage(body.data.url, options.research ?? {});
    } catch (error) {
      if (error instanceof FetchPageError) {
        return reply
          .code(badRequestReasons.has(error.reason) ? 400 : 502)
          .send({ error: error.message, reason: error.reason });
      }
      return reply.code(500).send({
        error: 'The research service failed unexpectedly. Paste the text instead.',
        reason: 'fetch-failed',
      });
    }
  });

  server.get('/api/research/mslearn-search', async (request, reply) => {
    const query = SearchQuery.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: 'A search query is required.' });
    }
    try {
      return { results: await searchMsLearnRanked(query.data.q, options.research?.fetchImpl) };
    } catch (error) {
      if (error instanceof MsLearnProxyError) {
        return reply.code(502).send({ error: error.message, reason: 'fetch-failed' });
      }
      return reply.code(500).send({
        error: 'The research service failed unexpectedly. Try again, or paste the summary instead.',
        reason: 'fetch-failed',
      });
    }
  });

  const staticDirectory =
    options.staticDirectory ?? resolve(import.meta.dirname, `../public${appBasePath}`);
  try {
    await access(staticDirectory);
    await server.register(fastifyStatic, {
      root: staticDirectory,
      prefix: `${appBasePath}/`,
      wildcard: false,
    });
    server.get(`${appBasePath}/*`, async (_request, reply) => reply.sendFile('index.html'));
    server.get('/', async (_request, reply) =>
      reply.redirect(`${appBasePath}/?token=${encodeURIComponent(options.token)}`),
    );
  } catch {
    server.get('/', async () => ({
      message: 'Dusori app assets are not built. Run pnpm build first.',
    }));
  }

  return server;
}
