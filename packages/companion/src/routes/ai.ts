import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  AiError,
  aiConfig,
  rerankWithAi,
  writeBriefWithAi,
  writeRecallPromptsWithAi,
  writeTutorPreferencesWithAi,
  type AiEnv,
} from '../ai.js';

const RerankBody = z.object({
  candidates: z
    .array(
      z.object({
        key: z.string().min(1),
        kind: z.string().optional(),
        snippet: z.string(),
        title: z.string().min(1),
        url: z.string().min(1),
      }),
    )
    .min(1)
    .max(40),
  query: z.string().min(1),
});

const BriefBody = z.object({
  query: z.string().min(1),
  sources: z
    .array(
      z.object({
        kind: z.string().optional(),
        reasons: z.array(z.string()).max(8),
        title: z.string().min(1),
        url: z.string().min(1),
      }),
    )
    .min(1)
    .max(20),
});

// A review session sends the objective and the excerpts already on the learner's screen, and
// nothing else. The caps are the contract: eight short excerpts is a whole session.
const RecallPromptsBody = z.object({
  excerpts: z
    .array(
      z.object({
        excerpt: z.string().min(1).max(400),
        heading: z.string().min(1).max(200),
        title: z.string().min(1).max(200),
      }),
    )
    .min(1)
    .max(8),
  objective: z.string().min(1).max(400),
});

// The preferences page and the learner's own request, and nothing else from the workspace.
const TutorBody = z.object({
  depth: z.string().min(1).max(40),
  preferences: z.array(z.string().min(1).max(200)).max(12),
  request: z.string().min(1).max(600),
  topicTitle: z.string().min(1).max(200),
});

export interface AiRoutesOptions {
  env?: AiEnv;
  fetchImpl?: typeof fetch;
}

function failureReply(error: unknown): { code: number; body: { error: string; reason: string } } {
  if (error instanceof AiError) {
    return {
      body: { error: error.message, reason: error.reason },
      code: error.reason === 'not-configured' ? 503 : 502,
    };
  }
  return {
    body: {
      error: 'The AI service failed unexpectedly. Ranking stays deterministic.',
      reason: 'ai-failed',
    },
    code: 500,
  };
}

export async function aiRoutes(server: FastifyInstance, options: AiRoutesOptions): Promise<void> {
  server.get('/api/ai/capabilities', async () => {
    const config = aiConfig(options.env);
    return { providers: config ? [config] : [] };
  });

  server.post('/api/ai/rerank', async (request, reply) => {
    const body = RerankBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'A query and candidates are required.' });
    }
    try {
      return { results: await rerankWithAi(body.data.query, body.data.candidates, options) };
    } catch (error) {
      const failure = failureReply(error);
      return reply.code(failure.code).send(failure.body);
    }
  });

  server.post('/api/ai/recall-prompts', async (request, reply) => {
    const body = RecallPromptsBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'An objective and source excerpts are required.' });
    }
    try {
      return {
        prompts: await writeRecallPromptsWithAi(body.data.objective, body.data.excerpts, options),
      };
    } catch (error) {
      const failure = failureReply(error);
      return reply.code(failure.code).send(failure.body);
    }
  });

  server.post('/api/ai/tutor', async (request, reply) => {
    const body = TutorBody.safeParse(request.body);
    if (!body.success) {
      return reply
        .code(400)
        .send({ error: 'A topic, current preferences, and a request are required.' });
    }
    try {
      return await writeTutorPreferencesWithAi(body.data, options);
    } catch (error) {
      const failure = failureReply(error);
      return reply.code(failure.code).send(failure.body);
    }
  });

  server.post('/api/ai/brief', async (request, reply) => {
    const body = BriefBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'A query and sources are required.' });
    }
    try {
      return { brief: await writeBriefWithAi(body.data.query, body.data.sources, options) };
    } catch (error) {
      const failure = failureReply(error);
      return reply.code(failure.code).send(failure.body);
    }
  });
}
