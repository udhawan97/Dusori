import { describe, expect, it, vi } from 'vitest';

import { OpfsStorageAdapter } from './index.js';

function adapterWithSnapshots(snapshots: Array<Error | File>): {
  adapter: OpfsStorageAdapter;
  close: ReturnType<typeof vi.fn>;
  getFile: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
} {
  const getFile = vi.fn();
  for (const snapshot of snapshots) {
    if (snapshot instanceof Error) getFile.mockRejectedValueOnce(snapshot);
    else getFile.mockResolvedValueOnce(snapshot);
  }
  const fallback = snapshots.findLast((snapshot): snapshot is File => snapshot instanceof File);
  getFile.mockResolvedValue(fallback);
  const write = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn().mockResolvedValue(undefined);
  const createWritable = vi.fn().mockResolvedValue({ close, write });
  const root = {
    getFileHandle: vi.fn().mockResolvedValue({ createWritable, getFile }),
  } as unknown as FileSystemDirectoryHandle;
  return { adapter: new OpfsStorageAdapter(root), close, getFile, write };
}

describe('OpfsStorageAdapter snapshot reads', () => {
  it('uses the newer file when the first post-write snapshot is stale', async () => {
    const stale = new File(['old ledger'], 'research.json', { lastModified: 10 });
    const current = new File(['current ledger'], 'research.json', { lastModified: 20 });
    const { adapter, getFile } = adapterWithSnapshots([stale, current]);

    await expect(adapter.read('research.json')).resolves.toMatchObject({
      content: 'current ledger',
      modifiedAt: 20,
    });
    expect(getFile).toHaveBeenCalledTimes(2);
  });

  it('does not replace a current snapshot with an older observation', async () => {
    const current = new File(['current ledger'], 'research.json', { lastModified: 20 });
    const stale = new File(['old ledger'], 'research.json', { lastModified: 10 });
    const { adapter } = adapterWithSnapshots([current, stale]);

    await expect(adapter.read('research.json')).resolves.toMatchObject({
      content: 'current ledger',
      modifiedAt: 20,
    });
  });

  it('prefers the second observation when modification times are equal', async () => {
    const first = new File(['preceding ledger'], 'research.json', { lastModified: 20 });
    const second = new File(['current ledger'], 'research.json', { lastModified: 20 });
    const { adapter } = adapterWithSnapshots([first, second]);

    await expect(adapter.read('research.json')).resolves.toMatchObject({
      content: 'current ledger',
      modifiedAt: 20,
    });
  });

  it('recovers from one transient snapshot read failure', async () => {
    const current = new File(['current ledger'], 'research.json', { lastModified: 20 });
    const { adapter } = adapterWithSnapshots([
      new DOMException('Writer is settling.', 'NotReadableError'),
      current,
    ]);

    await expect(adapter.read('research.json')).resolves.toMatchObject({
      content: 'current ledger',
      modifiedAt: 20,
    });
  });

  it('does not resolve a write until the newly written content is observable', async () => {
    const preceding = new File(['preceding ledger'], 'research.json', { lastModified: 10 });
    const current = new File(['current ledger'], 'research.json', { lastModified: 20 });
    const { adapter, close, getFile, write } = adapterWithSnapshots([
      preceding,
      preceding,
      preceding,
      preceding,
      current,
      current,
    ]);

    await expect(adapter.write('research.json', 'current ledger')).resolves.toMatchObject({
      content: 'current ledger',
      modifiedAt: 20,
    });
    expect(write).toHaveBeenCalledWith('current ledger');
    expect(close).toHaveBeenCalledOnce();
    expect(getFile).toHaveBeenCalledTimes(6);
  });
});
