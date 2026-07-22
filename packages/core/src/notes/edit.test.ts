import { describe, expect, it } from 'vitest';

import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace } from '../workspace/create.js';
import { createNote } from './edit.js';

const now = new Date('2026-07-21T20:00:00.000Z');

describe('note authoring', () => {
  it('creates a tracked portable Markdown note and records the action', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    const topic = await createTopic(storage, 'AI Fundamentals', now);

    const created = await createNote(storage, topic.topicSlug, 'Evidence map', now);

    expect(created.path).toBe('Topics/ai-fundamentals/Notes/evidence-map.md');
    expect(created.content).toContain('# Evidence map');
    expect((await storage.read(created.path))?.content).toBe(created.content);
    expect(created.state.fileIndex[created.path]?.hash).toMatch(/^[a-f0-9]{64}$/u);
    expect((await storage.read(created.updatePath))?.content).toContain(
      'Created [[../../../Notes/evidence-map|Evidence map]]',
    );
  });

  it('refuses to replace an existing note with the same portable name', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    const topic = await createTopic(storage, 'AI Fundamentals', now);
    await createNote(storage, topic.topicSlug, 'Evidence map', now);

    await expect(createNote(storage, topic.topicSlug, 'Evidence map', now)).rejects.toThrow(
      /already exists/u,
    );
  });
});
