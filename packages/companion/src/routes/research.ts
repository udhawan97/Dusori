import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { FetchPageError, fetchReadablePage, type LookupImpl } from '../research-fetch.js';
import { MsLearnProxyError, searchMsLearnRanked } from '../research-mslearn.js';

const FetchBody = z.object({ url: z.string().min(1) });
const SearchQuery = z.object({ q: z.string().min(1) });
const badRequestReasons = new Set([
  'blocked-host',
  'invalid-url',
  'too-large',
  'too-many-redirects',
  'unsupported-type',
]);

export interface ResearchRoutesOptions {
  fetchImpl?: typeof fetch;
  lookupImpl?: LookupImpl;
}

export async function researchRoutes(
  server: FastifyInstance,
  options: ResearchRoutesOptions,
): Promise<void> {
  server.post('/api/research/fetch', async (request, reply) => {
    const body = FetchBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'A url is required.', reason: 'invalid-url' });
    }
    try {
      return await fetchReadablePage(body.data.url, options);
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
      return { results: await searchMsLearnRanked(query.data.q, options.fetchImpl) };
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
}
