import { StorageConflictError } from '@dusori/core';
import { describe, expect, it } from 'vitest';

import { FsaStorageAdapter } from '../../storage-fsa/src/index.js';
import { OpfsStorageAdapter } from './index.js';

function directoryFixture() {
  const files = new Map<string, string>();
  let failNextWrite = false;
  const root = {
    async getFileHandle(name: string, options?: { create?: boolean }) {
      if (!files.has(name)) {
        if (!options?.create) throw new DOMException('Missing file', 'NotFoundError');
        files.set(name, '');
      }
      return {
        async getFile() {
          return new File([files.get(name)!], name, { lastModified: 1 });
        },
        async createWritable() {
          let pending = '';
          return {
            async write(content: string) {
              if (failNextWrite) {
                failNextWrite = false;
                throw new DOMException('Write denied', 'NotAllowedError');
              }
              pending = content;
            },
            async close() {
              files.set(name, pending);
            },
            async abort() {},
          };
        },
      };
    },
  } as unknown as FileSystemDirectoryHandle;
  return {
    root,
    fail: () => {
      failNextWrite = true;
    },
  };
}

describe.each([
  ['OPFS', OpfsStorageAdapter],
  ['FSA', FsaStorageAdapter],
] as const)('%s cooperating writes', (_label, Adapter) => {
  it.each([false, true])(
    'admits one guarded writer across instances (new file: %s)',
    async (create) => {
      const { root } = directoryFixture();
      const first = new Adapter(root);
      const second = new Adapter(root);
      const previous = create ? null : await first.write('note.md', 'original');
      const options = { expectedHash: previous?.hash ?? null };
      const outcomes = await Promise.allSettled([
        first.write('note.md', 'first', options),
        second.write('note.md', 'second', options),
      ]);
      const successes = outcomes.filter((outcome) => outcome.status === 'fulfilled');
      const failures = outcomes.filter((outcome) => outcome.status === 'rejected');
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect(failures[0]!.reason).toBeInstanceOf(StorageConflictError);
      expect(await first.read('note.md')).toEqual(successes[0]!.value);
    },
  );

  it('releases a failed write and does not hold an unrelated path', async () => {
    const fixture = directoryFixture();
    const first = new Adapter(fixture.root);
    const second = new Adapter(fixture.root);
    const original = await first.write('note.md', 'original');
    fixture.fail();
    await expect(
      first.write('note.md', 'denied', { expectedHash: original.hash }),
    ).rejects.toThrow();
    await expect(
      second.write('note.md', 'retry', { expectedHash: original.hash }),
    ).resolves.toMatchObject({ content: 'retry' });
    await expect(
      second.write('another.md', 'independent', { expectedHash: null }),
    ).resolves.toMatchObject({ content: 'independent' });
  });
});

it('refuses the FSA copy-delete fallback before removing its source', async () => {
  const { root } = directoryFixture();
  const storage = new FsaStorageAdapter(root);
  await storage.write('source.md', 'externally editable bytes');

  await expect(storage.move('source.md', 'target.md')).rejects.toThrow(
    /cannot atomically move connected-folder files/u,
  );
  expect((await storage.read('source.md'))?.content).toBe('externally editable bytes');
  expect(await storage.read('target.md')).toBeNull();
});
