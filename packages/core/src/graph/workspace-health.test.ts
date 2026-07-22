import { describe, expect, it } from 'vitest';

import { schemaVersion } from '../schemas/workspace.js';
import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace } from '../workspace/create.js';
import { proposeMarkdownUpdate } from '../conflict/write-protocol.js';
import { updateRoadmapObjective } from '../learning/loop.js';
import { backlinksFor, buildWorkspaceGraph } from './workspace-graph.js';
import { inspectWorkspaceHealth } from './workspace-health.js';

const now = new Date('2026-07-21T12:00:00.000Z');

describe('workspace backlinks and health', () => {
  it('derives backlinks only from resolved wikilink edges', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    await createTopic(storage, 'AI Fundamentals', now);
    await storage.write(
      'Topics/ai-fundamentals/Notes/evidence-map.md',
      '# Evidence map\n\nReturn to [[../Overview]] and [[../roadmap]].\n',
    );

    const graph = await buildWorkspaceGraph(storage);
    const backlinks = backlinksFor(graph, 'Topics/ai-fundamentals/Overview.md');

    expect(backlinks.map((node) => node.path)).toEqual([
      'Home.md',
      'Topics/ai-fundamentals/Notes/evidence-map.md',
      'Topics/ai-fundamentals/Updates/2026/07/2026-07-21.md',
    ]);
  });

  it('reports unresolved links, missing manifest sources, and untracked source files', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    await createTopic(storage, 'AI Fundamentals', now);
    const root = 'Topics/ai-fundamentals';
    await storage.write(`${root}/Notes/evidence-map.md`, '# Evidence map\n\nSee [[Missing note]].');
    await storage.write(`${root}/Sources/items/untracked.txt`, 'Loose source text');
    await storage.write(
      `${root}/Sources/manifest.json`,
      `${JSON.stringify(
        {
          schemaVersion,
          sources: [
            {
              fetchedAt: now.toISOString(),
              method: 'paste',
              path: `${root}/Sources/items/missing.txt`,
              sha256: 'a'.repeat(64),
              title: 'Missing source',
            },
          ],
        },
        null,
        2,
      )}\n`,
    );

    const health = await inspectWorkspaceHealth(storage);

    expect(health.status).toBe('attention');
    expect(health.issues.map((issue) => issue.kind)).toEqual([
      'missing-source-file',
      'unresolved-link',
      'untracked-source-file',
    ]);
    expect(health.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: `${root}/Sources/manifest.json`, target: 'missing.txt' }),
        expect.objectContaining({ path: `${root}/Notes/evidence-map.md`, target: 'Missing note' }),
        expect.objectContaining({ path: `${root}/Sources/items/untracked.txt` }),
      ]),
    );
  });

  it('leaves an invalid source manifest untouched while reporting it', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    await createTopic(storage, 'AI Fundamentals', now);
    const path = 'Topics/ai-fundamentals/Sources/manifest.json';
    await storage.write(path, '{ invalid json');

    const health = await inspectWorkspaceHealth(storage);

    expect(health.issues).toEqual([
      expect.objectContaining({ kind: 'invalid-source-manifest', path }),
    ]);
    expect((await storage.read(path))?.content).toBe('{ invalid json');
    expect((await storage.list('', true)).some((entry) => entry.path.includes('.invalid-'))).toBe(
      false,
    );
  });

  it('resolves links written by roadmap and conflict update entries', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    await createTopic(storage, 'AI Fundamentals', now);
    await updateRoadmapObjective(storage, 'ai-fundamentals', 0, true, now);
    const notePath = 'Topics/ai-fundamentals/Notes/001-first-look.md';
    const note = await storage.read(notePath);
    await storage.externalWrite(notePath, `${note?.content}\nExternal edit.\n`);
    await proposeMarkdownUpdate(
      storage,
      'ai-fundamentals',
      'Notes/001-first-look.md',
      `${note?.content}\nProposed edit.\n`,
      now,
    );

    const health = await inspectWorkspaceHealth(storage);

    expect(health.status).toBe('healthy');
    expect(health.graph.unresolvedLinks).toEqual([]);
  });
});
