import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';

import { appBasePath } from '../../../config/site.mjs';

import { canonicalRoot } from './filesystem.js';
import { aiRoutes, type AiRoutesOptions } from './routes/ai.js';
import { researchRoutes, type ResearchRoutesOptions } from './routes/research.js';
import { workspaceRoutes } from './routes/workspace.js';
import { companionVersion } from './version.js';

const sessionCookieName = 'dusori_session';

export interface ServerOptions {
  allowedOrigins?: readonly string[];
  /** @deprecated Prefer allowedOrigins so every permitted origin is explicit. */
  hostedOrigin?: string;
  root?: string;
  serveStatic?: boolean;
  staticDirectory?: string;
  token: string;
  research?: ResearchRoutesOptions;
  ai?: AiRoutesOptions;
}

function bearerToken(header: string | undefined): string | null {
  const match = header?.match(/^Bearer\s+(.+)$/u);
  return match?.[1] ?? null;
}

function cookieToken(header: string | undefined): string | null {
  for (const item of header?.split(';') ?? []) {
    const [name, ...value] = item.trim().split('=');
    if (name !== sessionCookieName) continue;
    try {
      return decodeURIComponent(value.join('='));
    } catch {
      return null;
    }
  }
  return null;
}

function sessionCookie(token: string, secure: boolean): string {
  return [
    `${sessionCookieName}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Strict',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export async function createServer(options: ServerOptions): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });
  const startedAt = Date.now();
  const root = options.root ? await canonicalRoot(options.root) : null;
  const hostedOrigin = options.hostedOrigin ?? 'https://udhawan97.github.io';
  const allowedOrigins = new Set(options.allowedOrigins ?? [hostedOrigin]);
  const allowSessionCookie = options.serveStatic !== false;

  await server.register(fastifyCors, {
    allowedHeaders: ['Authorization', 'Content-Type'],
    methods: ['GET', 'POST', 'OPTIONS'],
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
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
    if (origin && !allowedOrigins.has(origin) && origin !== ownOrigin) {
      await reply.code(403).send({ error: 'Origin is not allowed.' });
      return reply;
    }
    const bearer = bearerToken(request.headers.authorization);
    const cookie = allowSessionCookie ? cookieToken(request.headers.cookie) : null;
    if (bearer !== options.token && cookie !== options.token) {
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
  await server.register(aiRoutes, options.ai ?? {});

  if (options.serveStatic === false) {
    server.get('/', async () => ({
      apiOnly: true,
      message: 'Dusori companion API is running on loopback.',
    }));
    return server;
  }

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
    server.get('/', async (request, reply) => {
      reply.header('Set-Cookie', sessionCookie(options.token, request.protocol === 'https'));
      return reply.redirect(`${appBasePath}/`);
    });
  } catch {
    server.get('/', async () => ({
      message: 'Dusori app assets are not built. Run pnpm build first.',
    }));
  }

  return server;
}
