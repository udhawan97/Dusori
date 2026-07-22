import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';

import { appBasePath } from '../../../config/site.mjs';

import { canonicalRoot } from './filesystem.js';
import type { LookupImpl } from './research-fetch.js';
import { researchRoutes } from './routes/research.js';
import { workspaceRoutes } from './routes/workspace.js';
import { companionVersion } from './version.js';

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

  // Registered on the root instance before the route plugins, so it is inherited
  // by every encapsulated child context registered below.
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
    apiVersion: 1,
    service: 'dusori-companion',
    version: companionVersion,
    uptime: Math.floor((Date.now() - startedAt) / 1000),
  }));

  server.post('/api/session', async () => ({
    authenticated: true,
    rootSelected: Boolean(root),
  }));

  await server.register(workspaceRoutes, { root });
  await server.register(researchRoutes, options.research ?? {});

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
