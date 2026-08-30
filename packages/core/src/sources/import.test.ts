import { describe, expect, it, vi } from 'vitest';

import {
  StorageConflictError,
  type FileSnapshot,
  type StorageAdapter,
  type WriteOptions,
} from '../adapters.js';
import { exportWorkspace, importWorkspace } from '../portable.js';
import { SourceRecordSchema } from '../schemas/workspace.js';
import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace } from '../workspace/create.js';
import { updateLogPath } from '../workspace/paths.js';
import {
  addSource,
  maxSourceBytes,
  readSourceManifest,
  recordSourceFetchFailure,
  removeSourceFromResearch,
  restoreSourceToResearch,
} from './import.js';

const now = new Date('2026-07-20T15:30:00.000Z');
const manifestPath = 'Topics/ai-fundamentals/Sources/manifest.json';

async function topicStorage(): Promise<MemoryStorageAdapter> {
  const storage = new MemoryStorageAdapter();
  await createWorkspace(storage, 'Dusori', now);
  await createTopic(storage, 'AI Fundamentals', now);
  return storage;
}

/**
 * Wraps a MemoryStorageAdapter so the first `conflictBudget` writes to
 * `conflictPath` throw StorageConflictError with no other effect, then
 * delegates normally. appendTopicUpdate retries itself once internally (2
 * attempts total), so a budget of 2 exhausts ITS retry and makes it throw
 * out to the caller, same as a persistently contested log file would.
 * Counts writes to `countedPath` so tests can assert how many times the
 * manifest was actually written.
 */
class ConflictNTimesThenCount implements StorageAdapter {
  readonly kind = 'memory' as const;
  private conflictsLeft: number;
  writeCount = 0;

  constructor(
    private readonly inner: MemoryStorageAdapter,
    private readonly conflictPath: string,
    private readonly countedPath: string,
    conflictBudget: number,
  ) {
    this.conflictsLeft = conflictBudget;
  }

  ensureDirectory(path: string): Promise<void> {
    return this.inner.ensureDirectory(path);
  }

  list(path?: string, recursive?: boolean) {
    return this.inner.list(path, recursive);
  }

  move(from: string, to: string): Promise<void> {
    return this.inner.move(from, to);
  }

  read(path: string): Promise<FileSnapshot | null> {
    return this.inner.read(path);
  }

  remove(path: string, recursive?: boolean): Promise<void> {
    return this.inner.remove(path, recursive);
  }

  async write(path: string, content: string, options?: WriteOptions): Promise<FileSnapshot> {
    if (path === this.countedPath) this.writeCount += 1;
    if (this.conflictsLeft > 0 && path === this.conflictPath) {
      this.conflictsLeft -= 1;
      const current = await this.inner.read(path);
      throw new StorageConflictError(path, options?.expectedHash ?? null, current?.hash ?? null);
    }
    return this.inner.write(path, content, options);
  }
}

describe('local source library', () => {
  it('stores pasted text, validates the manifest, and appends an update entry', async () => {
    const storage = await topicStorage();
    const result = await addSource(
      storage,
      {
        content: 'A model maps inputs to outputs.\n',
        method: 'paste',
        tags: ['Evidence', 'ｅｖｉｄｅｎｃｅ', 'ai/foundations'],
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
        tags: ['evidence', 'ai/foundations'],
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
    expect(result.record.citation).toMatchObject({
      identifiers: [{ scheme: 'arxiv', value: '1706.03762' }],
      provenance: [{ method: 'source-url' }],
    });
    expect((await storage.read(result.path))?.content).toContain(
      'stored this reference without fetching',
    );
    vi.unstubAllGlobals();
  });

  it('stores captured research content and upgrades the same URL without duplicating it', async () => {
    const storage = await topicStorage();
    const content =
      '# Microsoft Entra ID\n\nOriginal URL: <https://learn.microsoft.com/training/modules/describe-identity-principles/>\n\nCatalog reference captured on 2026-07-20.\n';
    const origin = {
      capturedAt: now.toISOString(),
      capturedVia: 'catalog-reference' as const,
      provider: 'mslearn' as const,
    };
    const result = await addSource(
      storage,
      {
        content,
        method: 'url',
        origin,
        title: 'Microsoft Entra ID',
        topicSlug: 'ai-fundamentals',
        url: 'https://learn.microsoft.com/training/modules/describe-identity-principles/',
      },
      now,
    );

    expect((await storage.read(result.path))?.content).toBe(content);
    expect(result.record).toMatchObject({ method: 'url', origin });
    expect((await readSourceManifest(storage, 'ai-fundamentals', now)).sources[0]).toMatchObject({
      method: 'url',
      origin,
    });
    expect((await storage.read(result.updatePath!))?.content).toContain('Added url source');

    const duplicate = await addSource(
      storage,
      {
        content: '# A changed capture that must not create a duplicate.\n',
        method: 'url',
        origin,
        provenance: { readState: 'readable' },
        title: 'Renamed capture',
        topicSlug: 'ai-fundamentals',
        url: 'https://learn.microsoft.com/training/modules/describe-identity-principles/',
      },
      now,
    );
    expect(duplicate).toMatchObject({ deduplicated: true, path: result.path, upgraded: true });
    const manifest = await readSourceManifest(storage, 'ai-fundamentals', now);
    expect(manifest.sources).toHaveLength(1);
    expect(manifest.sources[0]?.readState).toBe('readable');
    expect(manifest.synthesisStaleAt).toBe(now.toISOString());
    expect((await storage.read(result.path))?.content).toContain('changed capture');
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

  it('removes a source from active research without deleting its item and restores after reload', async () => {
    const storage = await topicStorage();
    const added = await addSource(
      storage,
      {
        content: '# Evidence\n\nA durable source reports that local files remain available.\n',
        method: 'url',
        provenance: { readState: 'readable' },
        title: 'Durable evidence',
        topicSlug: 'ai-fundamentals',
        url: 'https://example.org/evidence',
      },
      now,
    );

    const removed = await removeSourceFromResearch(
      storage,
      { sha256: added.record.sha256, topicSlug: 'ai-fundamentals' },
      now,
    );
    const afterRemove = await readSourceManifest(storage, 'ai-fundamentals', now);
    expect(afterRemove.sources).toEqual([]);
    expect(afterRemove.removedSources?.[0]?.record.sha256).toBe(added.record.sha256);
    expect(afterRemove.synthesisStaleAt).toBe(now.toISOString());
    expect(await storage.read(removed.retainedPath!)).not.toBeNull();

    await restoreSourceToResearch(
      storage,
      { sha256: added.record.sha256, topicSlug: 'ai-fundamentals' },
      now,
    );
    const afterRestore = await readSourceManifest(storage, 'ai-fundamentals', now);
    expect(afterRestore.sources).toHaveLength(1);
    expect(afterRestore.removedSources).toEqual([]);
  });

  it('never downgrades active or removed readable text with a weaker reference capture', async () => {
    const storage = await topicStorage();
    const content = '# Durable evidence\n\nThis readable text must not be replaced by a stub.\n';
    const input = {
      content,
      method: 'url' as const,
      provenance: { readState: 'readable' as const },
      title: 'Durable evidence',
      topicSlug: 'ai-fundamentals',
      url: 'https://example.org/durable-evidence',
    };
    const added = await addSource(storage, input, now);

    const activeRediscovery = await addSource(
      storage,
      {
        ...input,
        content: '# Reference stub\n\nNo readable evidence was captured.\n',
        provenance: { readState: 'reference' },
      },
      now,
    );
    expect(activeRediscovery).toMatchObject({
      deduplicated: true,
      record: { readState: 'readable' },
    });
    expect((await storage.read(added.path))?.content).toBe(content);

    await removeSourceFromResearch(
      storage,
      { sha256: added.record.sha256, topicSlug: 'ai-fundamentals' },
      now,
    );
    const removedRediscovery = await addSource(
      storage,
      {
        ...input,
        content: '# Reference stub\n\nNo readable evidence was captured.\n',
        provenance: { readState: 'reference' },
      },
      now,
    );

    expect(removedRediscovery).toMatchObject({ deduplicated: true, tombstoned: true });
    const manifest = await readSourceManifest(storage, 'ai-fundamentals', now);
    expect(manifest.sources).toEqual([]);
    expect(manifest.removedSources?.[0]?.record.readState).toBe('readable');
    expect((await storage.read(added.path))?.content).toBe(content);
  });

  it('restores a removed URL with a fresh readable capture and clears its old failure', async () => {
    const storage = await topicStorage();
    const input = {
      content: '# Original capture\n\nThis source contains a durable statement for research.\n',
      method: 'url' as const,
      provenance: { readState: 'readable' as const },
      title: 'Restorable reference',
      topicSlug: 'ai-fundamentals',
      url: 'https://example.org/restorable',
    };
    const added = await addSource(storage, input, now);
    await removeSourceFromResearch(
      storage,
      { sha256: added.record.sha256, topicSlug: 'ai-fundamentals' },
      now,
    );

    await restoreSourceToResearch(
      storage,
      { sha256: added.record.sha256, topicSlug: 'ai-fundamentals' },
      now,
    );
    await recordSourceFetchFailure(
      storage,
      {
        message: 'The page answered with 401.',
        sha256: added.record.sha256,
        state: 'blocked',
        status: 401,
        topicSlug: 'ai-fundamentals',
      },
      now,
    );
    await removeSourceFromResearch(
      storage,
      { sha256: added.record.sha256, topicSlug: 'ai-fundamentals' },
      now,
    );

    const rediscovered = await addSource(
      storage,
      {
        ...input,
        content: '# Fresh capture\n\nNew readable evidence replaces the failed reference.\n',
      },
      new Date('2026-07-22T09:00:00.000Z'),
    );
    expect(rediscovered).toMatchObject({ deduplicated: true, restored: true, path: added.path });
    const manifest = await readSourceManifest(storage, 'ai-fundamentals', now);
    expect(manifest.sources).toHaveLength(1);
    expect(manifest.sources[0]).not.toHaveProperty('fetchState');
    expect(manifest.sources[0]?.readState).toBe('readable');
    expect((await storage.read(added.path))?.content).toContain('Fresh capture');
    expect(manifest.removedSources).toEqual([]);
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

  it('surfaces the retry-exhausted message when the manifest write conflicts on all three attempts', async () => {
    const storage = await topicStorage();
    // Every one of addSource's three attempts conflicts, so the loop must
    // exhaust naturally and surface the mandated user-facing message instead
    // of the raw StorageConflictError from the final attempt.
    const conflicting = new ConflictNTimesThenCount(storage, manifestPath, manifestPath, 3);

    await expect(
      addSource(
        conflicting,
        {
          content: 'A model maps inputs to outputs.\n',
          method: 'paste',
          title: 'Model definition',
          topicSlug: 'ai-fundamentals',
        },
        now,
      ),
    ).rejects.toThrow('The source manifest changed repeatedly. Try adding the source again.');
  });

  it('reports a secondary warning without denying the committed source when the update log fails', async () => {
    const storage = await topicStorage();
    const later = new Date('2026-07-21T09:00:00.000Z');
    const logPath = updateLogPath('ai-fundamentals', later);
    // appendTopicUpdate has its own 2-attempt retry; conflicting both of its
    // attempts exhausts that budget so it throws StorageConflictError back out
    // to addSource. The manifest write, one line above it, already succeeded.
    const conflicting = new ConflictNTimesThenCount(storage, logPath, manifestPath, 2);

    const result = await addSource(
      conflicting,
      {
        content: 'A model maps inputs to outputs.\n',
        method: 'paste',
        title: 'Model definition',
        topicSlug: 'ai-fundamentals',
      },
      later,
    );
    expect(result.warning).toMatch(/activity log/u);

    // The manifest must not be rewritten (and the record duplicated) just
    // because the unrelated log append failed after its own retry.
    expect(conflicting.writeCount).toBe(1);
    expect((await readSourceManifest(storage, 'ai-fundamentals', later)).sources).toHaveLength(1);
    expect(await storage.read(logPath)).toBeNull();
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

describe('source origin schema', () => {
  it('accepts companion and future provenance values as tolerant strings', () => {
    const record = SourceRecordSchema.parse({
      fetchedAt: '2026-07-21T00:00:00.000Z',
      method: 'url',
      origin: {
        capturedAt: '2026-07-21T00:00:00.000Z',
        capturedVia: 'page-extract',
        provider: 'companion',
      },
      sha256: 'a'.repeat(64),
      title: 'Example',
      url: 'https://example.org/',
    });
    expect(record.origin?.provider).toBe('companion');
    expect(() =>
      SourceRecordSchema.parse({
        fetchedAt: '2026-07-21T00:00:00.000Z',
        method: 'url',
        origin: {
          capturedAt: '2026-07-21T00:00:00.000Z',
          capturedVia: 'page-extract',
          provider: '',
        },
        sha256: 'a'.repeat(64),
        title: 'Example',
        url: 'https://example.org/',
      }),
    ).toThrow();
  });
});
