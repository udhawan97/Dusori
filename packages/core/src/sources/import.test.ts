import { describe, expect, it, vi } from 'vitest';

import { exportWorkspace, importWorkspace } from '../portable.js';
import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace } from '../workspace/create.js';
import { addSource, maxSourceBytes, readSourceManifest } from './import.js';

const now = new Date('2026-07-20T15:30:00.000Z');

async function topicStorage(): Promise<MemoryStorageAdapter> {
  const storage = new MemoryStorageAdapter();
  await createWorkspace(storage, 'Dusori', now);
  await createTopic(storage, 'AI Fundamentals', now);
  return storage;
}

describe('local source library', () => {
  it('stores pasted text, validates the manifest, and appends an update entry', async () => {
    const storage = await topicStorage();
    const result = await addSource(
      storage,
      {
        content: 'A model maps inputs to outputs.\n',
        method: 'paste',
        title: 'Model definition',
        topicSlug: 'ai-fundamentals',
      },
      now,
    );

    expect(result.deduplicated).toBe(false);
    expect(result.path).toMatch(
      /^Topics\/ai-fundamentals\/Sources\/items\/[a-f0-9]{12}-model-definition\.txt$/u,
    );
    expect((await storage.read(result.path))?.content).toBe('A model maps inputs to outputs.\n');
    expect((await readSourceManifest(storage, 'ai-fundamentals', now)).sources).toEqual([
      expect.objectContaining({
        method: 'paste',
        path: result.path,
        size: 32,
        title: 'Model definition',
      }),
    ]);
    expect((await storage.read(result.updatePath!))?.content).toContain('Added paste source');
  });

  it('preserves local Markdown and keeps the original filename as metadata', async () => {
    const storage = await topicStorage();
    const result = await addSource(
      storage,
      {
        content: '# Attention\r\n\r\nA weighted sum.\r\n',
        mediaType: 'text/markdown',
        method: 'file',
        originalName: 'attention-notes.md',
        title: 'Attention notes',
        topicSlug: 'ai-fundamentals',
      },
      now,
    );

    expect(result.path).toMatch(/\.md$/u);
    expect((await storage.read(result.path))?.content).toBe('# Attention\n\nA weighted sum.\n');
    expect(result.record.originalName).toBe('attention-notes.md');
  });

  it('stores a URL reference without fetching it', async () => {
    const storage = await topicStorage();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    const result = await addSource(
      storage,
      {
        method: 'url',
        title: 'Transformers paper',
        topicSlug: 'ai-fundamentals',
        url: 'https://arxiv.org/abs/1706.03762',
      },
      now,
    );

    expect(fetch).not.toHaveBeenCalled();
    expect(result.record.url).toBe('https://arxiv.org/abs/1706.03762');
    expect((await storage.read(result.path))?.content).toContain(
      'stored this reference without fetching',
    );
    vi.unstubAllGlobals();
  });

  it('deduplicates identical sources without adding another update', async () => {
    const storage = await topicStorage();
    const input = {
      content: 'Same source.\n',
      method: 'paste' as const,
      title: 'First title',
      topicSlug: 'ai-fundamentals',
    };
    const first = await addSource(storage, input, now);
    const updateBefore = (await storage.read(first.updatePath!))?.content;
    const duplicate = await addSource(storage, { ...input, title: 'Renamed copy' }, now);

    expect(duplicate.deduplicated).toBe(true);
    expect(duplicate.path).toBe(first.path);
    expect((await readSourceManifest(storage, 'ai-fundamentals', now)).sources).toHaveLength(1);
    expect((await storage.read(first.updatePath!))?.content).toBe(updateBefore);
  });

  it('rejects empty, oversized, credential-bearing, and non-web sources', async () => {
    const storage = await topicStorage();
    await expect(
      addSource(storage, {
        content: '  ',
        method: 'paste',
        title: 'Empty',
        topicSlug: 'ai-fundamentals',
      }),
    ).rejects.toThrow(/empty/u);
    await expect(
      addSource(storage, {
        content: 'a'.repeat(maxSourceBytes + 1),
        method: 'paste',
        title: 'Too large',
        topicSlug: 'ai-fundamentals',
      }),
    ).rejects.toThrow(/2 MiB/u);
    await expect(
      addSource(storage, {
        method: 'url',
        title: 'Local file',
        topicSlug: 'ai-fundamentals',
        url: 'file:///private/notes.txt',
      }),
    ).rejects.toThrow(/http/u);
    await expect(
      addSource(storage, {
        method: 'url',
        title: 'Private URL',
        topicSlug: 'ai-fundamentals',
        url: 'https://user:secret@example.com/',
      }),
    ).rejects.toThrow(/username or password/u);
  });

  it('keeps source files and metadata through a ZIP round trip', async () => {
    const source = await topicStorage();
    const added = await addSource(
      source,
      {
        content: 'Portable source.\n',
        method: 'paste',
        title: 'Portable source',
        topicSlug: 'ai-fundamentals',
      },
      now,
    );
    const target = new MemoryStorageAdapter();
    await importWorkspace(target, await exportWorkspace(source));

    expect((await target.read(added.path))?.content).toBe('Portable source.\n');
    expect((await readSourceManifest(target, 'ai-fundamentals', now)).sources).toHaveLength(1);
  });
});
