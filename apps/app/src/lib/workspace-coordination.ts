import { coordinateStorage, type StorageAdapter } from '@dusori/core';

/** Same-kind roots share a conservative lock; folder handle identity is not stable across tabs. */
export function coordinateAppStorage(storage: StorageAdapter) {
  if (typeof navigator === 'undefined' || !navigator.locks) return coordinateStorage(storage);
  const key = `dusori:workspace-mutation:v1:${storage.kind}`;
  return coordinateStorage(storage, {
    generation: () => localStorage.getItem(key) ?? '',
    advanceGeneration: () => localStorage.setItem(key, crypto.randomUUID()),
    runExclusive: (operation) => navigator.locks.request(key, operation),
  });
}
