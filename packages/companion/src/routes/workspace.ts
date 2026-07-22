import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { StorageConflictError } from '@dusori/core';

import { listWorkspace, readWorkspaceFile, writeWorkspaceFile } from '../filesystem.js';

const WriteBody = z.object({
  path: z.string().min(1),
  content: z.string(),
  expectedHash: z.string().length(64).nullable().optional(),
});

export interface WorkspaceRoutesOptions {
  root: string | null;
}

export async function workspaceRoutes(
  server: FastifyInstance,
  options: WorkspaceRoutesOptions,
): Promise<void> {
  const { root } = options;

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
}
