export type BrowserStorageBackend = 'indexeddb' | 'opfs';

export interface BrowserStorageBackendState {
  available: boolean;
  hasWorkspace: boolean;
}

export class BrowserStorageSelectionError extends Error {
  constructor(
    readonly code: 'ambiguous' | 'recorded-backend-unavailable' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'BrowserStorageSelectionError';
  }
}

/**
 * Firefox currently exposes the OPFS entry point in some environments without completing its
 * promise. Prefer the durable IndexedDB implementation there instead of starting an OPFS probe
 * that can leave the workspace action pending forever.
 */
export function browserEngineRequiresIndexedDb(userAgent: string): boolean {
  return /(?:^|\s)Firefox\//u.test(userAgent);
}

/**
 * Chooses one durable browser backend without ever substituting an empty store for recorded data.
 * Existing data wins over a stale marker; two populated stores remain an explicit recovery case.
 */
export function selectBrowserStorageBackend(
  recorded: BrowserStorageBackend | null,
  opfs: BrowserStorageBackendState,
  indexeddb: BrowserStorageBackendState,
  options: { create: boolean },
): BrowserStorageBackend | null {
  if (opfs.hasWorkspace && indexeddb.hasWorkspace) {
    if (recorded) return recorded;
    throw new BrowserStorageSelectionError(
      'ambiguous',
      'Dusori found two browser workspaces in separate local storage backends, but the backend marker is missing. It stopped before opening either so neither copy is hidden or overwritten. Restore this site’s data from a browser backup before removing either copy.',
    );
  }
  if (opfs.hasWorkspace) return 'opfs';
  if (indexeddb.hasWorkspace) return 'indexeddb';

  if (recorded) {
    const state = recorded === 'opfs' ? opfs : indexeddb;
    if (!state.available) {
      const label = recorded === 'opfs' ? 'OPFS' : 'IndexedDB';
      throw new BrowserStorageSelectionError(
        'recorded-backend-unavailable',
        `Dusori could not reopen the recorded ${label} workspace. It did not switch to an empty fallback. Try again in this browser and export a backup when it opens.`,
      );
    }
    if (options.create) return recorded;
  }
  if (!options.create) return null;
  if (opfs.available) return 'opfs';
  if (indexeddb.available) return 'indexeddb';
  throw new BrowserStorageSelectionError(
    'unavailable',
    'This browser could not open private local storage. No workspace was created. Try again or continue in a supported Chromium browser.',
  );
}
