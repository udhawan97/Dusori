import { describe, expect, it, vi } from 'vitest';

import { OpfsStorageAdapter } from './index.js';

function adapterWithSnapshots(snapshots: Array<Error | File>): {
  adapter: OpfsStorageAdapter;
  getFile: ReturnType<typeof vi.fn>;
} {
  const getFile = vi.fn();
  for (const snapshot of snapshots) {
    if (snapshot instanceof Error) getFile.mockRejectedValueOnce(snapshot);
    else getFile.mockResolvedValueOnce(snapshot);
  }
  const fallback = snapshots.findLast((snapshot): snapshot is File => snapshot instanceof File);
  getFile.mockResolvedValue(fallback);
  const root = {
    getFileHandle: vi.fn().mockResolvedValue({ getFile }),
  } as unknown as FileSystemDirectoryHandle;
  return { adapter: new OpfsStorageAdapter(root), getFile };
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
});
