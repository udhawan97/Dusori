import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { StorageConflictError } from '@dusori/core';
import { afterEach, describe, expect, it } from 'vitest';

import { canonicalRoot, readWorkspaceFile, writeWorkspaceFile } from './filesystem.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('companion conditional writes', () => {
  it.each([false, true])(
    'preserves one winner for simultaneous API writes (new file: %s)',
    async (create) => {
      const root = await canonicalRoot(await mkdtemp(join(tmpdir(), 'dusori-cas-')));
      roots.push(root);
      const original = create ? null : await writeWorkspaceFile(root, 'note.md', 'original');
      const outcomes = await Promise.allSettled([
        writeWorkspaceFile(root, 'note.md', 'first', original?.hash ?? null),
        writeWorkspaceFile(root, 'note.md', 'second', original?.hash ?? null),
      ]);
      const successes = outcomes.filter((outcome) => outcome.status === 'fulfilled');
      const failures = outcomes.filter((outcome) => outcome.status === 'rejected');
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect(failures[0]!.reason).toBeInstanceOf(StorageConflictError);
      expect(await readWorkspaceFile(root, 'note.md')).toEqual(successes[0]!.value);
      await expect(
        writeWorkspaceFile(root, 'note.md', 'retry', successes[0]!.value.hash),
      ).resolves.toMatchObject({ content: 'retry' });
      await expect(
        writeWorkspaceFile(root, 'other.md', 'independent', null),
      ).resolves.toMatchObject({ content: 'independent' });
    },
  );
});
