import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ArxivProxyError, searchArxiv } from '../research-arxiv.js';
import { FetchPageError, fetchReadablePage, type LookupImpl } from '../research-fetch.js';
import { MsLearnProxyError, searchMsLearnRanked } from '../research-mslearn.js';
import { RedditProxyError, redditConfig, searchReddit } from '../research-reddit.js';
import {
  WebSearchError,
  searchWeb,
  webSearchConfig,
  type WebSearchEnv,
} from '../research-websearch.js';
import {
  YouTubeError,
  fetchYouTubeThumbnail,
  searchYouTube,
  youtubeConfig,
} from '../research-youtube.js';

const FetchBody = z.object({ url: z.string().min(1) });
const SearchQuery = z.object({ q: z.string().min(1) });
const VideoQuery = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{11}$/u) });
const badRequestReasons = new Set([
  'blocked-host',
  'invalid-url',
  'redirect-host',
  'too-large',
  'too-many-redirects',
  'unsupported-type',
]);

export interface ResearchRoutesOptions {
  env?: WebSearchEnv;
  fetchImpl?: typeof fetch;
  lookupImpl?: LookupImpl;
}

export async function researchRoutes(
  server: FastifyInstance,
  options: ResearchRoutesOptions,
): Promise<void> {
  server.get('/api/research/capabilities', async () => {
    const env = options.env ?? process.env;
    const web = webSearchConfig(env);
    const youtube = youtubeConfig(env);
    const reddit = redditConfig(env);
    return {
      providers: [
        { available: true, id: 'arxiv', mode: 'keyless' },
        { available: true, id: 'mslearn', mode: 'keyless' },
        {
          available: Boolean(web),
          id: 'websearch',
          ...(web ? { mode: web.kind } : { reason: 'not-configured' }),
        },
        {
          available: Boolean(youtube),
          id: 'youtube',
          mode: youtube ? `${youtube.kind}-metadata-reference-only` : 'metadata-reference-only',
          ...(youtube ? {} : { reason: 'not-configured' }),
        },
        {
          available: Boolean(reddit),
          id: 'reddit',
          ...(reddit ? { mode: 'oauth' } : { reason: 'not-configured' }),
        },
      ],
    };
  });

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
          .send({ error: error.message, reason: error.reason, status: error.status });
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

  server.get('/api/research/arxiv', async (request, reply) => {
    const query = SearchQuery.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: 'A search query is required.' });
    }
    try {
      return { results: await searchArxiv(query.data.q, options.fetchImpl) };
    } catch (error) {
      if (error instanceof ArxivProxyError) {
        return reply.code(502).send({ error: error.message, reason: 'fetch-failed' });
      }
      return reply.code(500).send({
        error: 'The research service failed unexpectedly. Try again, or paste the summary instead.',
        reason: 'fetch-failed',
      });
    }
  });

  server.get('/api/research/reddit', async (request, reply) => {
    const query = SearchQuery.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: 'A search query is required.' });
    }
    try {
      return {
        results: await searchReddit(query.data.q, {
          ...(options.env ? { env: options.env } : {}),
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        }),
      };
    } catch (error) {
      if (error instanceof RedditProxyError) {
        return reply
          .code(error.reason === 'not-configured' ? 503 : 502)
          .send({ error: error.message, reason: error.reason });
      }
      return reply.code(500).send({
        error: 'The research service failed unexpectedly. Try again, or paste the summary instead.',
        reason: 'fetch-failed',
      });
    }
  });

  // Metadata uses the official YouTube Data API when configured, with a self-hosted Invidious
  // fallback. Captions and media are never fetched; thumbnails stay behind the local companion.
  function youtubeFailure(error: unknown): { code: number; reason: string } {
    if (!(error instanceof YouTubeError)) return { code: 500, reason: 'fetch-failed' };
    if (error.reason === 'not-configured') return { code: 503, reason: error.reason };
    if (error.reason === 'invalid-id') return { code: 400, reason: error.reason };
    return { code: 502, reason: error.reason };
  }

  server.get('/api/research/youtube', async (request, reply) => {
    const query = SearchQuery.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: 'A search query is required.' });
    }
    try {
      return { results: await searchYouTube(query.data.q, options) };
    } catch (error) {
      const failure = youtubeFailure(error);
      return reply.code(failure.code).send({
        error:
          error instanceof YouTubeError
            ? error.message
            : 'The research service failed unexpectedly. Try again, or paste the summary instead.',
        reason: failure.reason,
      });
    }
  });

  server.get('/api/research/youtube-transcript', async (request, reply) => {
    const query = VideoQuery.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: 'A video id is required.', reason: 'invalid-id' });
    }
    return reply.code(403).send({
      error:
        'Dusori does not harvest YouTube captions. Add transcript text through Paste or File only when you supplied it, own it, or are authorized to use it.',
      reason: 'transcript-requires-user-supplied',
    });
  });

  server.get('/api/research/youtube-thumbnail', async (request, reply) => {
    const query = VideoQuery.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: 'A video id is required.', reason: 'invalid-id' });
    }
    try {
      const image = await fetchYouTubeThumbnail(query.data.id, options);
      return reply
        .code(200)
        .header('Content-Type', image.contentType)
        .header('Cache-Control', 'private, max-age=3600')
        .send(Buffer.from(image.body));
    } catch (error) {
      const failure = youtubeFailure(error);
      return reply.code(failure.code).send({
        error:
          error instanceof YouTubeError
            ? error.message
            : 'The research service failed unexpectedly.',
        reason: failure.reason,
      });
    }
  });

  server.get('/api/research/web-search', async (request, reply) => {
    const query = SearchQuery.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: 'A search query is required.' });
    }
    try {
      return {
        results: await searchWeb(query.data.q, { env: options.env, fetchImpl: options.fetchImpl }),
      };
    } catch (error) {
      if (error instanceof WebSearchError) {
        return reply
          .code(error.reason === 'not-configured' ? 503 : 502)
          .send({ error: error.message, reason: error.reason });
      }
      return reply.code(500).send({
        error: 'The research service failed unexpectedly. Try again, or paste the summary instead.',
        reason: 'fetch-failed',
      });
    }
  });
}
