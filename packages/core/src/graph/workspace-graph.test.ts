import { describe, expect, it } from 'vitest';

import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { addSource, removeSourceFromResearch, restoreSourceToResearch } from '../sources/import.js';
import { createTopic, createWorkspace } from '../workspace/create.js';
import { buildWorkspaceGraph, resolveWikilink } from './workspace-graph.js';

const now = new Date('2026-07-20T12:00:00.000Z');

describe('portable workspace graph', () => {
  it('maps files, topic containment, and Obsidian wikilinks without a graph database', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    await createTopic(storage, 'AI Fundamentals', now);
    const source = await addSource(
      storage,
      {
        content: 'A quoted source without a Markdown heading.',
        method: 'paste',
        title: 'Readable source title',
        topicSlug: 'ai-fundamentals',
      },
      now,
    );
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
    expect(graph.nodes.find((node) => node.path === source.path)).toMatchObject({
      kind: 'source',
      label: 'Readable source title',
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

  it('maps typed learner relations and research events with inspectable edge explanations', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    await createTopic(storage, 'AI Fundamentals', now);
    const source = await addSource(
      storage,
      {
        content: 'A local source.',
        method: 'paste',
        title: 'Local source',
        topicSlug: 'ai-fundamentals',
      },
      now,
    );
    const notePath = 'Topics/ai-fundamentals/Notes/source-note.md';
    await storage.write(
      notePath,
      [
        '---',
        'title: "Source note"',
        'annotation: source-quote',
        'tags: [Research/Annotation, Evidence]',
        'relations:',
        '  - type: follow-up-to',
        `    target: ${JSON.stringify(source.path)}`,
        '---',
        '',
        '# Source note',
      ].join('\n'),
    );
    const threadId = `thread-${'a'.repeat(24)}`;
    const eventId = `event-${'b'.repeat(24)}`;
    await storage.write(
      'Topics/ai-fundamentals/research.json',
      `${JSON.stringify({
        activeThreadId: threadId,
        dismissed: [],
        events: [
          {
            at: now.toISOString(),
            eventId,
            notePath,
            noteSha256: 'c'.repeat(64),
            sourcePath: source.path,
            sourceSha256: source.record.sha256,
            threadId,
            type: 'note-added',
          },
        ],
        schemaVersion: 1,
        threads: [
          {
            createdAt: now.toISOString(),
            outputStyle: 'brief',
            questionText: 'What matters?',
            threadId,
          },
        ],
        topicSlug: 'ai-fundamentals',
      })}\n`,
    );

    const graph = await buildWorkspaceGraph(storage);
    const annotation = graph.nodes.find((node) => node.path === notePath);
    const event = graph.nodes.find((node) => node.eventId === eventId);
    const relation = graph.edges.find(
      (edge) => edge.kind === 'relation' && edge.source === notePath,
    );
    const activity = graph.edges.find(
      (edge) => edge.kind === 'activity' && edge.source === event?.id,
    );

    expect(annotation).toMatchObject({
      kind: 'annotation',
      tags: ['research/annotation', 'evidence'],
    });
    expect(event).toMatchObject({ eventId, kind: 'event', threadId });
    expect(relation).toMatchObject({
      explanation: expect.stringMatching(/learner-authored.*follow-up-to/iu),
      relation: 'follow-up-to',
      target: source.path,
    });
    expect(activity).toMatchObject({
      explanation: expect.stringMatching(/source note saved/iu),
    });
    expect(graph.edges.every((edge) => edge.explanation.trim().length > 0)).toBe(true);
  });

  it('hides tombstoned source items and brings them back after restore', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    await createTopic(storage, 'AI Fundamentals', now);
    const source = await addSource(
      storage,
      {
        content: '# Evidence\n\nA quoted source.\n',
        method: 'url',
        provenance: { readState: 'readable' },
        title: 'Source to remove',
        topicSlug: 'ai-fundamentals',
        url: 'https://example.org/removal',
      },
      now,
    );

    await removeSourceFromResearch(
      storage,
      { sha256: source.record.sha256, topicSlug: 'ai-fundamentals' },
      now,
    );
    expect(
      (await buildWorkspaceGraph(storage)).nodes.some((node) => node.path === source.path),
    ).toBe(false);

    await restoreSourceToResearch(
      storage,
      { sha256: source.record.sha256, topicSlug: 'ai-fundamentals' },
      now,
    );
    expect(
      (await buildWorkspaceGraph(storage)).nodes.some((node) => node.path === source.path),
    ).toBe(true);
  });
});

describe('wikilink resolution', () => {
  const paths = new Set([
    'Home.md',
    'Topics/ai-fundamentals/Overview.md',
    'Topics/ai-fundamentals/roadmap.md',
    'Topics/ai-fundamentals/Notes/concept-map.md',
    'Topics/ai-fundamentals/Notes/second look.md',
    'Topics/ai-fundamentals/Updates/2026/07/2026-07-31.md',
    'Topics/cloud/Notes/shared.md',
    'Topics/networking/Notes/shared.md',
    'Topics/ai-fundamentals/Sources/items/abc-notes.txt',
  ]);

  it('resolves a target named from the workspace root', () => {
    expect(resolveWikilink('Topics/ai-fundamentals/Notes/concept-map.md', 'Home', paths)).toBe(
      'Home.md',
    );
  });

  it('resolves a target relative to the linking document', () => {
    expect(
      resolveWikilink('Topics/ai-fundamentals/Notes/concept-map.md', '../Overview', paths),
    ).toBe('Topics/ai-fundamentals/Overview.md');
  });

  it('resolves a bare name against the linking document topic', () => {
    expect(
      resolveWikilink('Topics/ai-fundamentals/Updates/2026/07/2026-07-31.md', 'roadmap', paths),
    ).toBe('Topics/ai-fundamentals/roadmap.md');
  });

  it('resolves a unique basename anywhere in the workspace', () => {
    expect(resolveWikilink('Home.md', 'concept-map', paths)).toBe(
      'Topics/ai-fundamentals/Notes/concept-map.md',
    );
  });

  it('refuses a basename two documents share', () => {
    expect(resolveWikilink('Home.md', 'shared', paths)).toBeNull();
  });

  it('strips an alias and a heading anchor before matching', () => {
    expect(resolveWikilink('Home.md', 'Topics/ai-fundamentals/roadmap#Objectives', paths)).toBe(
      'Topics/ai-fundamentals/roadmap.md',
    );
    expect(resolveWikilink('Home.md', 'concept-map|the map', paths)).toBe(
      'Topics/ai-fundamentals/Notes/concept-map.md',
    );
  });

  it('resolves a target that keeps its own extension', () => {
    expect(resolveWikilink('Home.md', 'abc-notes.txt', paths)).toBe(
      'Topics/ai-fundamentals/Sources/items/abc-notes.txt',
    );
  });

  it('returns null for an empty target and for one that matches nothing', () => {
    expect(resolveWikilink('Home.md', '   ', paths)).toBeNull();
    expect(resolveWikilink('Home.md', 'Missing note', paths)).toBeNull();
  });
});
