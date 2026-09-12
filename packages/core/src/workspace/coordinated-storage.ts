import type { FileSnapshot, StorageAdapter, StorageEntry, WriteOptions } from '../adapters.js';

export type CoordinatedStorageAdapter = StorageAdapter &
  Required<Pick<StorageAdapter, 'runExclusiveWorkspaceMutation'>> & {
    /** Capture before starting asynchronous work; replacement invalidates all scoped access. */
    createWorkspaceScope(): CoordinatedStorageAdapter;
    /** Check before publishing an asynchronous result or retaining it for a later retry. */
    assertWorkspaceCurrent(): void;
  };

interface WorkspaceGeneration {
  local: number;
  host: string | undefined;
}

interface CoordinatedCacheEntry {
  adapter: CoordinatedStorageAdapter;
  attachHost(host: WorkspaceMutationHost): void;
}

const coordinatedAdapters = new WeakMap<StorageAdapter, CoordinatedCacheEntry>();
const mutationTails = new WeakMap<StorageAdapter, Promise<void>>();

/** The application supplies cross-context coordination without browser imports in core. */
export interface WorkspaceMutationHost {
  generation(): string;
  advanceGeneration(): void;
  runExclusive<T>(operation: () => Promise<T>): Promise<T>;
}

async function withLocalMutationQueue<T>(
  storage: StorageAdapter,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = mutationTails.get(storage) ?? Promise.resolve();
  let release = (): void => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  mutationTails.set(
    storage,
    previous.then(
      () => current,
      () => current,
    ),
  );
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
  }
}

/**
 * Serializes adapter mutations with replacement. Queued writes belong to the generation in
 * which they were requested, so they cannot resume against a replaced workspace. A host may
 * extend this boundary across tabs; raw adapters and external editors do not participate.
 */
export function coordinateStorage(
  storage: StorageAdapter,
  host?: WorkspaceMutationHost,
): CoordinatedStorageAdapter {
  const existing = coordinatedAdapters.get(storage);
  if (existing) {
    if (host) existing.attachHost(host);
    return existing.adapter;
  }
  let generation = 0;
  const captureGeneration = (): WorkspaceGeneration => ({
    local: generation,
    host: host?.generation(),
  });
  const assertGeneration = (requested: WorkspaceGeneration): void => {
    if (generation !== requested.local || host?.generation() !== requested.host) {
      throw new Error('The workspace was replaced. Reopen it before retrying this change.');
    }
  };
  const mutate = <T>(
    operation: () => Promise<T>,
    replacement = false,
    requested = captureGeneration(),
  ): Promise<T> => {
    return withLocalMutationQueue(storage, () => {
      const guarded = async () => {
        assertGeneration(requested);
        if (!replacement) return operation();
        // Invalidate queued work even after an unsuccessful replacement: a failed rollback
        // may have left recovery material that must not be changed by an older operation.
        try {
          return await operation();
        } finally {
          generation += 1;
          host?.advanceGeneration();
        }
      };
      return host ? host.runExclusive(guarded) : guarded();
    });
  };

  const attachHost = (next: WorkspaceMutationHost): void => {
    host ??= next;
  };
  const createAdapter = (requested?: WorkspaceGeneration): CoordinatedStorageAdapter => {
    const view: CoordinatedStorageAdapter = {
      kind: storage.kind,
      supportsSafeWorkspaceRelocation: storage.supportsSafeWorkspaceRelocation,
      // A scoped workflow cannot refresh its generation by coordinating or scoping again.
      createWorkspaceScope: () => (requested ? view : createAdapter(captureGeneration())),
      assertWorkspaceCurrent: () => {
        if (requested) assertGeneration(requested);
      },
      ensureDirectory: (path: string) =>
        mutate(() => storage.ensureDirectory(path), false, requested),
      list: (path?: string, recursive?: boolean): Promise<StorageEntry[]> =>
        requested
          ? mutate(() => storage.list(path, recursive), false, requested)
          : storage.list(path, recursive),
      move: (from: string, to: string) => mutate(() => storage.move(from, to), false, requested),
      read: (path: string): Promise<FileSnapshot | null> =>
        requested ? mutate(() => storage.read(path), false, requested) : storage.read(path),
      remove: (path: string, recursive?: boolean) =>
        mutate(() => storage.remove(path, recursive), false, requested),
      runExclusiveWorkspaceMutation: <T>(operation: (inner: StorageAdapter) => Promise<T>) =>
        mutate(
          () => storage.runExclusiveWorkspaceMutation?.(operation) ?? operation(storage),
          true,
          requested,
        ),
      write: (path: string, content: string, options?: WriteOptions) =>
        mutate(() => storage.write(path, content, options), false, requested),
    };
    coordinatedAdapters.set(view, { adapter: view, attachHost });
    return view;
  };
  const coordinated = createAdapter();
  // Upgrade in place so references returned before app activation cannot keep bypassing the
  // host. Retain the queue, generation, and wrapper identity across repeated activation.
  const cached: CoordinatedCacheEntry = { adapter: coordinated, attachHost };
  coordinatedAdapters.set(storage, cached);
  coordinatedAdapters.set(coordinated, cached);
  return coordinated;
}
