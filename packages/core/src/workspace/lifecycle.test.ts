import { describe, expect, it } from 'vitest';

import { WorkspaceSchema } from '../schemas/workspace.js';
import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace } from './create.js';
import { deleteTopic, setTopicArchived } from './lifecycle.js';

const now = new Date('2026-07-20T12:00:00.000Z');

async function readWorkspace(storage: MemoryStorageAdapter) {
  return WorkspaceSchema.parse(JSON.parse((await storage.read('dusori.json'))!.content));
}

describe('deleteTopic', () => {
  it('erases the topic tree and drops it from the workspace index', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    await createTopic(storage, 'Keep Me', now);
    await createTopic(storage, 'Delete Me', now);

    const workspace = await deleteTopic(storage, 'delete-me', now);

    expect(workspace.topics.map((topic) => topic.slug)).toEqual(['keep-me']);
    const remaining = (await storage.list('', true)).map((entry) => entry.path);
    expect(remaining.some((path) => path.startsWith('Topics/delete-me/'))).toBe(false);
    expect(remaining).toContain('Topics/keep-me/Overview.md');
  });

  it('rewrites Home.md without the deleted topic', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    await createTopic(storage, 'Delete Me', now);

    await deleteTopic(storage, 'delete-me', now);

    const home = (await storage.read('Home.md'))!.content;
    expect(home).not.toContain('Delete Me');
  });

  it('throws for an unknown slug', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);

    await expect(deleteTopic(storage, 'ghost', now)).rejects.toThrow(/no topic/iu);
  });
});

describe('setTopicArchived', () => {
  it('flags a topic as archived and back again in the workspace index', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    await createTopic(storage, 'Shelf Me', now);

    const archived = await setTopicArchived(storage, 'shelf-me', true, now);
    expect(archived.topics.find((topic) => topic.slug === 'shelf-me')?.archived).toBe(true);
    expect((await readWorkspace(storage)).topics[0]?.archived).toBe(true);

    const restored = await setTopicArchived(storage, 'shelf-me', false, now);
    expect(restored.topics.find((topic) => topic.slug === 'shelf-me')?.archived).toBeFalsy();
  });

  it('keeps the topic files intact when archived', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    await createTopic(storage, 'Shelf Me', now);

    await setTopicArchived(storage, 'shelf-me', true, now);

    expect(await storage.read('Topics/shelf-me/Overview.md')).not.toBeNull();
  });

  it('throws for an unknown slug', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);

    await expect(setTopicArchived(storage, 'ghost', true, now)).rejects.toThrow(/no topic/iu);
  });
});
