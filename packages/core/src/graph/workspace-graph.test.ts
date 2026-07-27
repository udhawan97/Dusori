import { describe, expect, it } from 'vitest';

import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace } from '../workspace/create.js';
import { buildWorkspaceGraph } from './workspace-graph.js';

const now = new Date('2026-07-20T12:00:00.000Z');

describe('portable workspace graph', () => {
  it('maps files, topic containment, and Obsidian wikilinks without a graph database', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    await createTopic(storage, 'AI Fundamentals', now);
    await storage.write(
      'Topics/ai-fundamentals/Notes/concept-map.md',
      '# Concept map\n\nReturn to [[../Overview]] and [[roadmap]]. See [[Missing note]].\n',
    );

    const graph = await buildWorkspaceGraph(storage);

    expect(graph.nodes.map((node) => node.path)).toEqual(
      expect.arrayContaining([
        'Home.md',
        'Topics/ai-fundamentals/Overview.md',
        'Topics/ai-fundamentals/roadmap.md',
        'Topics/ai-fundamentals/TUTOR.md',
        'Topics/ai-fundamentals/Notes/001-first-look.md',
        'Topics/ai-fundamentals/Notes/concept-map.md',
      ]),
    );
    expect(graph.nodes.find((node) => node.path === 'Home.md')).toMatchObject({
      kind: 'home',
      label: 'Dusori',
    });
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'Home.md',
          target: 'Topics/ai-fundamentals/Overview.md',
          kind: 'links',
        }),
        expect.objectContaining({
          source: 'Topics/ai-fundamentals/Overview.md',
          target: 'Topics/ai-fundamentals/Notes/001-first-look.md',
          kind: 'links',
        }),
        expect.objectContaining({
          source: 'Topics/ai-fundamentals/Overview.md',
          target: 'Topics/ai-fundamentals/Notes/concept-map.md',
          kind: 'contains',
        }),
        expect.objectContaining({
          source: 'Topics/ai-fundamentals/Notes/concept-map.md',
          target: 'Topics/ai-fundamentals/Overview.md',
          kind: 'links',
        }),
        expect.objectContaining({
          source: 'Topics/ai-fundamentals/Notes/concept-map.md',
          target: 'Topics/ai-fundamentals/roadmap.md',
          kind: 'links',
        }),
      ]),
    );
    expect(graph.unresolvedLinks).toEqual([
      {
        source: 'Topics/ai-fundamentals/Notes/concept-map.md',
        target: 'Missing note',
      },
    ]);
  });

  it('carries the tags of each document onto its node', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.write(
      'Topics/cloud/Notes/vnet.md',
      `---\ntitle: Virtual networks\ntags: [azure, networking]\n---\n\nAlso filed under #cloud/design.`,
    );
    await storage.write('Topics/cloud/Notes/plain.md', `---\ntitle: Plain\n---\n\nNo tags here.`);

    const graph = await buildWorkspaceGraph(storage);
    const tagged = graph.nodes.find((node) => node.path === 'Topics/cloud/Notes/vnet.md');
    const plain = graph.nodes.find((node) => node.path === 'Topics/cloud/Notes/plain.md');

    expect(tagged?.tags).toEqual(['azure', 'networking', 'cloud/design']);
    expect(plain?.tags).toBeUndefined();
  });
});
