import { describe, expect, it } from 'vitest';

import { StorageConflictError, type FileSnapshot, type WriteOptions } from '../adapters.js';
import type { FetchedPage } from '../research/companion.js';
import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace } from '../workspace/create.js';
import { topicRoot } from '../workspace/paths.js';
import { addSource, maxSourceBytes, readSourceManifest } from './import.js';
import { buildUpgradedContent, upgradeSource } from './upgrade.js';

// Fails the *first* write to a chosen path with StorageConflictError, then lets
// every later write (including the retry) through normally. Used to drive
// upgradeSource's manifest-conflict retry path without touching its logic.
class FlakyOnceStorage extends MemoryStorageAdapter {
  armed = false;
  writeAttempts = 0;

  constructor(private readonly failPath: string) {
    super();
  }

  override async write(path: string, content: string, options?: WriteOptions): Promise<FileSnapshot> {
    if (this.armed && path === this.failPath) {
      this.writeAttempts += 1;
      if (this.writeAttempts === 1) {
        const current = await this.read(path);
        throw new StorageConflictError(path, options?.expectedHash ?? null, current?.hash ?? null);
      }
    }
    return super.write(path, content, options);
  }
}

const now = new Date('2026-07-21T15:30:00.000Z');

const page: FetchedPage = {
  byline: 'A. Vaswani',
  fetchedAt: '2026-07-21T15:30:00.000Z',
  finalUrl: 'https://example.org/attention-final',
  siteName: 'Example Journal',
  text: 'Attention lets each token weigh the other tokens in its context.',
  title: 'Attention in transformers',
  truncated: false,
};

async function urlSourceFixture() {
  const storage = new MemoryStorageAdapter();
  await createWorkspace(storage, 'Dusori', now);
  await createTopic(storage, 'Transformers', now);
  const added = await addSource(
    storage,
    { method: 'url', title: 'Attention paper', topicSlug: 'transformers', url: 'https://example.org/attention' },
    now,
  );
  return { added, storage };
}

// Shaped like the Phase 1 mslearn provider's capture() output (see
// research/providers/mslearn.ts): a `method: 'url'` source whose item file
// already holds real catalog-reference markdown, not the bare addSource stub.
async function catalogReferenceFixture() {
  const storage = new MemoryStorageAdapter();
  await createWorkspace(storage, 'Dusori', now);
  await createTopic(storage, 'Transformers', now);
  const captureContent = [
    '# Attention paper',
    '',
    'Original URL: <https://example.org/attention>',
    '',
    'A short catalog snippet about attention mechanisms.',
    '',
    '## Catalog metadata',
    '',
    '- Module UID: attention-basics',
    '',
    'This is a Microsoft Learn catalog reference captured on 2026-07-20, not a snapshot of the module page.',
    '',
  ].join('\n');
  const added = await addSource(
    storage,
    {
      content: captureContent,
      method: 'url',
      origin: { capturedAt: now.toISOString(), capturedVia: 'catalog-reference', provider: 'mslearn' },
      title: 'Attention paper',
      topicSlug: 'transformers',
      url: 'https://example.org/attention',
    },
    now,
  );
  return { added, storage };
}

describe('buildUpgradedContent', () => {
  it('writes provenance and the resolved URL when it differs', () => {
    const content = buildUpgradedContent(
      {
        fetchedAt: now.toISOString(),
        method: 'url',
        sha256: 'a'.repeat(64),
        title: 'Attention paper',
        url: 'https://example.org/attention',
      },
      page,
    );
    expect(content).toContain('# Attention paper');
    expect(content).toContain('Original URL: <https://example.org/attention>');
    expect(content).toContain('Resolved URL: <https://example.org/attention-final>');
    expect(content).toContain('Byline: A. Vaswani');
    expect(content).toContain('Site: Example Journal');
    expect(content).toContain('Fetched from example.org on 2026-07-21 via the local companion.');
    expect(content).toContain('weigh the other tokens');
  });

  it('caps oversized text with the shared truncation marker', () => {
    const content = buildUpgradedContent(
      { fetchedAt: now.toISOString(), method: 'url', sha256: 'a'.repeat(64), title: 'Big', url: 'https://example.org/big' },
      { ...page, text: 'x'.repeat(maxSourceBytes + 1024) },
    );
    expect(new TextEncoder().encode(content).byteLength).toBeLessThanOrEqual(maxSourceBytes);
    expect(content.endsWith('\n\n[truncated]\n')).toBe(true);
  });
});

describe('upgradeSource', () => {
  it('replaces the stub, updates the manifest record, and logs the update', async () => {
    const { added, storage } = await urlSourceFixture();
    const stub = await storage.read(added.path);
    const upgraded = await upgradeSource(
      storage,
      { expectedContentHash: stub!.hash, page, sha256: added.record.sha256, topicSlug: 'transformers' },
      now,
    );

    const item = await storage.read(upgraded.path);
    expect(item?.content).toContain('weigh the other tokens');

    const manifest = await readSourceManifest(storage, 'transformers', now);
    const record = manifest.sources.find((source) => source.sha256 === added.record.sha256);
    expect(record).toMatchObject({
      mediaType: 'text/markdown',
      method: 'url',
      origin: { capturedVia: 'page-extract', provider: 'companion' },
      path: added.path,
      sha256: added.record.sha256,
      title: 'Attention paper',
      url: 'https://example.org/attention',
    });
    expect(record?.size).toBe(new TextEncoder().encode(item?.content ?? '').byteLength);

    const log = await storage.read(upgraded.updatePath ?? '');
    expect(log?.content).toContain('Upgraded url source');
    expect(log?.content).toContain('Attention paper');
  });

  it('upgrades a Phase 1 research-capture source (not the bare stub) when the expected hash matches', async () => {
    // Regression test: the guard must not assume pre-upgrade content is the
    // addSource stub. Phase 1 research acceptance writes real capture markdown
    // (catalog reference / plain-text extract) into method: 'url' item files,
    // and upgrading exactly that content is the headline use case.
    const { added, storage } = await catalogReferenceFixture();
    const captured = await storage.read(added.path);
    expect(captured?.content).toContain('catalog reference');

    const upgraded = await upgradeSource(
      storage,
      { expectedContentHash: captured!.hash, page, sha256: added.record.sha256, topicSlug: 'transformers' },
      now,
    );

    const item = await storage.read(upgraded.path);
    expect(item?.content).toContain('weigh the other tokens');
    expect(upgraded.record.sha256).toBe(added.record.sha256);
  });

  it('retries once after a manifest write conflict, without double-writing the item file or the update log', async () => {
    const manifestPath = `${topicRoot('transformers')}/Sources/manifest.json`;
    const storage = new FlakyOnceStorage(manifestPath);
    await createWorkspace(storage, 'Dusori', now);
    await createTopic(storage, 'Transformers', now);
    const added = await addSource(
      storage,
      { method: 'url', title: 'Attention paper', topicSlug: 'transformers', url: 'https://example.org/attention' },
      now,
    );
    const stub = await storage.read(added.path);

    // Arm the flake only for the upgrade call itself, so fixture setup above
    // (which also writes the manifest) is unaffected.
    storage.armed = true;
    const upgraded = await upgradeSource(
      storage,
      { expectedContentHash: stub!.hash, page, sha256: added.record.sha256, topicSlug: 'transformers' },
      now,
    );

    // The manifest write was actually intercepted once and retried: this
    // proves the test drives the retry path rather than the happy path.
    expect(storage.writeAttempts).toBeGreaterThanOrEqual(2);

    const item = await storage.read(upgraded.path);
    expect(item?.content).toBe(buildUpgradedContent(added.record, page));

    const log = await storage.read(upgraded.updatePath ?? '');
    const updateEntries = log?.content.split('Upgraded url source').length ?? 1;
    expect(updateEntries - 1).toBe(1);

    expect(upgraded.record.sha256).toBe(added.record.sha256);
  });

  it('raises StorageConflictError when the item file changed outside Dusori', async () => {
    const { added, storage } = await urlSourceFixture();
    const item = await storage.read(added.path);
    const expectedContentHash = item!.hash;
    storage.files.set(added.path, { content: `${item?.content ?? ''}external edit\n`, modifiedAt: 99 });
    await expect(
      upgradeSource(
        storage,
        { expectedContentHash, page, sha256: added.record.sha256, topicSlug: 'transformers' },
        now,
      ),
    ).rejects.toBeInstanceOf(StorageConflictError);
  });

  it('rejects unknown source ids with a friendly sentence', async () => {
    const { storage } = await urlSourceFixture();
    await expect(
      upgradeSource(
        storage,
        { expectedContentHash: '0'.repeat(64), page, sha256: 'b'.repeat(64), topicSlug: 'transformers' },
        now,
      ),
    ).rejects.toThrow('This URL source is missing from the manifest. Refresh and try again.');
  });
});
