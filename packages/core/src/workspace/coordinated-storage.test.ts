import { describe, expect, it } from 'vitest';

import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { coordinateStorage, type WorkspaceMutationHost } from './coordinated-storage.js';

describe('workspace mutation coordination', () => {
  it.each(['local', 'host'])(
    'rejects an old workflow whose first write follows a %s replacement',
    async (replacementContext) => {
      const raw = new MemoryStorageAdapter();
      let generation = 0;
      let tail = Promise.resolve();
      const host: WorkspaceMutationHost = {
        generation: () => String(generation),
        advanceGeneration: () => {
          generation += 1;
        },
        runExclusive: (operation) => {
          const next = tail.then(operation);
          tail = next.then(
            () => undefined,
            () => undefined,
          );
          return next;
        },
      };
      const storage = coordinateStorage(raw, host);
      const replacementStorage =
        replacementContext === 'local'
          ? storage
          : coordinateStorage(
              {
                kind: raw.kind,
                ensureDirectory: raw.ensureDirectory.bind(raw),
                list: raw.list.bind(raw),
                move: raw.move.bind(raw),
                read: raw.read.bind(raw),
                remove: raw.remove.bind(raw),
                write: raw.write.bind(raw),
              },
              host,
            );
      await storage.write('Home.md', '# Original');
      const workflowStorage = storage.createWorkspaceScope();
      expect(() => workflowStorage.assertWorkspaceCurrent()).not.toThrow();
      expect((await workflowStorage.read('Home.md'))?.content).toBe('# Original');
      let finishProvider = () => {};
      const provider = new Promise<void>((resolve) => {
        finishProvider = resolve;
      });
      const workflow = (async () => {
        await provider;
        // The workflow has not enqueued any mutation when replacement completes.
        await workflowStorage.write('Home.md', '# Old provider result');
      })();
      const staleWorkflow = expect(workflow).rejects.toThrow(/workspace was replaced/u);
      await replacementStorage.runExclusiveWorkspaceMutation((inner) =>
        inner.write('Home.md', '# Imported'),
      );
      finishProvider();
      await staleWorkflow;

      // Reads and every mutation remain bound to the original generation, including after
      // another call to the coordinator. Old work cannot inspect or modify imported data.
      expect(coordinateStorage(workflowStorage)).toBe(workflowStorage);
      expect(workflowStorage.createWorkspaceScope()).toBe(workflowStorage);
      expect(() => workflowStorage.assertWorkspaceCurrent()).toThrow(/workspace was replaced/u);
      const staleOperations = [
        () => workflowStorage.read('Home.md'),
        () => workflowStorage.list(),
        () => workflowStorage.ensureDirectory('old-run'),
        () => workflowStorage.move('Home.md', 'Moved.md'),
        () => workflowStorage.remove('Home.md'),
        () => workflowStorage.runExclusiveWorkspaceMutation((inner) => inner.remove('Home.md')),
      ];
      for (const operation of staleOperations) {
        await expect(operation()).rejects.toThrow(/workspace was replaced/u);
      }
      expect((await raw.read('Home.md'))?.content).toBe('# Imported');
      expect(await raw.read('Moved.md')).toBeNull();
      expect(await raw.list()).not.toContainEqual({ kind: 'directory', path: 'old-run' });
      await expect(
        storage.createWorkspaceScope().write('Home.md', '# New workflow'),
      ).resolves.toMatchObject({
        content: '# New workflow',
      });
    },
  );

  it.each(['raw', 'wrapper'])(
    'activates host hooks after earlier hostless coordination through the %s adapter',
    async (activationTarget) => {
      const raw = new MemoryStorageAdapter();
      const initial = coordinateStorage(raw);
      await initial.runExclusiveWorkspaceMutation((storage) => storage.write('Home.md', 'import'));

      let lockCalls = 0;
      let generation = 0;
      let generationReads = 0;
      const host: WorkspaceMutationHost = {
        generation: () => {
          generationReads += 1;
          return String(generation);
        },
        advanceGeneration: () => {
          generation += 1;
        },
        runExclusive: async (operation) => {
          lockCalls += 1;
          return operation();
        },
      };
      const activated = coordinateStorage(activationTarget === 'raw' ? raw : initial, host);
      expect(activated).toBe(initial);
      expect(coordinateStorage(raw, host)).toBe(activated);
      expect(coordinateStorage(activated)).toBe(activated);
      // Even a reference obtained before activation now participates in host coordination.
      await initial.write('Home.md', 'host-coordinated edit');
      expect(lockCalls).toBe(1);
      expect(generationReads).toBe(2);
      await activated.runExclusiveWorkspaceMutation((storage) =>
        storage.write('Home.md', 'second import'),
      );
      expect(lockCalls).toBe(2);
      expect(generation).toBe(1);
      expect((await raw.read('Home.md'))?.content).toBe('second import');
    },
  );

  it('rejects a write queued by another host context during replacement', async () => {
    let generation = 0;
    let tail = Promise.resolve();
    const host: WorkspaceMutationHost = {
      generation: () => String(generation),
      advanceGeneration: () => {
        generation += 1;
      },
      runExclusive: (operation) => {
        const next = tail.then(operation);
        tail = next.then(
          () => undefined,
          () => undefined,
        );
        return next;
      },
    };
    const raw = new MemoryStorageAdapter();
    // Separate adapter identities model two contexts over the same persisted workspace.
    const first = coordinateStorage(raw, host);
    const second = coordinateStorage(
      {
        kind: raw.kind,
        ensureDirectory: raw.ensureDirectory.bind(raw),
        list: raw.list.bind(raw),
        move: raw.move.bind(raw),
        read: raw.read.bind(raw),
        remove: raw.remove.bind(raw),
        write: raw.write.bind(raw),
      },
      host,
    );
    let release = () => {};
    let entered = () => {};
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const replacing = first.runExclusiveWorkspaceMutation(async (storage) => {
      entered();
      await paused;
      await storage.write('Home.md', '# Imported');
    });
    await ready;
    const stale = expect(second.write('Home.md', '# Old workspace edit')).rejects.toThrow(
      /workspace was replaced/u,
    );
    release();
    await Promise.all([replacing, stale]);
    expect((await first.read('Home.md'))?.content).toBe('# Imported');
    await second.write('Home.md', '# New deliberate edit');
    expect((await first.read('Home.md'))?.content).toBe('# New deliberate edit');
  });

  it('releases a failed replacement and invalidates previously queued writes', async () => {
    const storage = coordinateStorage(new MemoryStorageAdapter());
    const failed = expect(
      storage.runExclusiveWorkspaceMutation(async () => {
        throw new Error('Failed rollback');
      }),
    ).rejects.toThrow('Failed rollback');
    const stale = expect(storage.write('Home.md', 'stale')).rejects.toThrow(
      /workspace was replaced/u,
    );
    await Promise.all([failed, stale]);
    await expect(storage.write('Home.md', 'retry')).resolves.toMatchObject({ content: 'retry' });
  });
});
