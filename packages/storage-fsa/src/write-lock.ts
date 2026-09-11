const pendingWrites = new Map<string, Promise<void>>();

/**
 * Web Locks coordinate same-origin tabs as well as adapter instances. The logical path is
 * deliberately shared across roots: over-serializing equal paths is preferable to guessing a
 * folder handle identity. Other origins and external editors do not participate in this lock.
 * The fallback coordinates this JavaScript realm when Web Locks are unavailable.
 */
export async function withFileWriteLock<T>(path: string, write: () => Promise<T>): Promise<T> {
  const key = `dusori:file-write:v1:${path.normalize('NFC').toLowerCase()}`;
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(key, write);
  }
  const previous = pendingWrites.get(key) ?? Promise.resolve();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => held);
  pendingWrites.set(key, tail);
  await previous;
  try {
    return await write();
  } finally {
    release();
    if (pendingWrites.get(key) === tail) pendingWrites.delete(key);
  }
}
