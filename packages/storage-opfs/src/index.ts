import {
  StorageConflictError,
  normalizeWorkspacePath,
  sha256,
  type FileSnapshot,
  type StorageAdapter,
  type StorageEntry,
  type WriteOptions,
} from '@dusori/core';

import {
  BrowserStorageSelectionError,
  browserEngineRequiresIndexedDb,
  selectBrowserStorageBackend,
  type BrowserStorageBackend,
  type BrowserStorageBackendState,
} from './browser-selection.js';
import { IndexedDbStorageAdapter, indexedDbWorkspaceDatabaseExists } from './indexed-db.js';

export {
  BrowserStorageSelectionError,
  browserEngineRequiresIndexedDb,
  IndexedDbStorageAdapter,
  selectBrowserStorageBackend,
  type BrowserStorageBackend,
  type BrowserStorageBackendState,
};

export const browserStorageBackendKey = 'dusori-browser-storage-backend:v1';

export type BrowserStorageAdapter = IndexedDbStorageAdapter | OpfsStorageAdapter;

interface BrowserStorageInspection extends BrowserStorageBackendState {
  adapter?: BrowserStorageAdapter;
}

async function directoryAt(
  root: FileSystemDirectoryHandle,
  path: string,
  create = false,
): Promise<FileSystemDirectoryHandle> {
  const normalized = normalizeWorkspacePath(path);
  let current = root;
  for (const segment of normalized.split('/').filter(Boolean)) {
    current = await current.getDirectoryHandle(segment, { create });
  }
  return current;
}

async function parentAndName(
  root: FileSystemDirectoryHandle,
  path: string,
  createParent = false,
): Promise<[FileSystemDirectoryHandle, string]> {
  const normalized = normalizeWorkspacePath(path);
  const segments = normalized.split('/');
  const name = segments.pop();
  if (!name) throw new Error('A file path is required.');
  return [await directoryAt(root, segments.join('/'), createParent), name];
}

export class OpfsStorageAdapter implements StorageAdapter {
  readonly kind = 'opfs' as const;

  constructor(private readonly root: FileSystemDirectoryHandle) {}

  async ensureDirectory(path: string): Promise<void> {
    await directoryAt(this.root, path, true);
  }

  async list(path = '', recursive = false): Promise<StorageEntry[]> {
    const normalized = normalizeWorkspacePath(path);
    const directory = await directoryAt(this.root, normalized);
    const entries: StorageEntry[] = [];
    const visit = async (current: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
      for await (const [name, handle] of current.entries()) {
        const entryPath = prefix ? `${prefix}/${name}` : name;
        entries.push({ kind: handle.kind, path: entryPath });
        if (recursive && handle.kind === 'directory') await visit(handle, entryPath);
      }
    };
    await visit(directory, normalized);
    return entries.sort((left, right) => left.path.localeCompare(right.path));
  }

  async move(from: string, to: string): Promise<void> {
    const source = await this.read(from);
    if (!source) throw new Error(`Missing file: ${from}`);
    await this.write(to, source.content, { expectedHash: null });
    await this.remove(from);
  }

  async read(path: string): Promise<FileSnapshot | null> {
    const normalized = normalizeWorkspacePath(path);
    try {
      const [parent, name] = await parentAndName(this.root, normalized);
      const handle = await parent.getFileHandle(name);
      const file = await handle.getFile();
      const content = await file.text();
      return {
        content,
        hash: await sha256(content),
        modifiedAt: file.lastModified,
        path: normalized,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return null;
      throw error;
    }
  }

  async remove(path: string, recursive = false): Promise<void> {
    const [parent, name] = await parentAndName(this.root, path);
    await parent.removeEntry(name, { recursive });
  }

  async write(path: string, content: string, options: WriteOptions = {}): Promise<FileSnapshot> {
    const normalized = normalizeWorkspacePath(path);
    const current = await this.read(normalized);
    if (options.expectedHash === null && current) {
      throw new StorageConflictError(normalized, null, current.hash);
    }
    if (typeof options.expectedHash === 'string' && current?.hash !== options.expectedHash) {
      throw new StorageConflictError(normalized, options.expectedHash, current?.hash ?? null);
    }
    const [parent, name] = await parentAndName(this.root, normalized, true);
    const handle = await parent.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    return (await this.read(normalized))!;
  }
}

export async function createOpfsStorage(
  workspaceDirectory = 'Dusori',
): Promise<OpfsStorageAdapter> {
  const originRoot = await navigator.storage.getDirectory();
  const workspaceRoot = await originRoot.getDirectoryHandle(workspaceDirectory, { create: true });
  await navigator.storage.persist?.().catch(() => false);
  return new OpfsStorageAdapter(workspaceRoot);
}

function readBackendMarker(): BrowserStorageBackend | null {
  try {
    const value = localStorage.getItem(browserStorageBackendKey);
    return value === 'indexeddb' || value === 'opfs' ? value : null;
  } catch {
    return null;
  }
}

function writeBackendMarker(backend: BrowserStorageBackend): boolean {
  try {
    localStorage.setItem(browserStorageBackendKey, backend);
    return localStorage.getItem(browserStorageBackendKey) === backend;
  } catch {
    return false;
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError';
}

async function within<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new OpfsProbeTimeoutError()), milliseconds);
    promise.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

class OpfsProbeTimeoutError extends Error {
  constructor() {
    super('Private file storage did not respond in time.');
    this.name = 'OpfsProbeTimeoutError';
  }
}

async function inspectOpfs(workspaceDirectory: string): Promise<BrowserStorageInspection> {
  if (typeof navigator.storage?.getDirectory !== 'function') {
    return { available: false, hasWorkspace: false };
  }
  if (browserEngineRequiresIndexedDb(navigator.userAgent)) {
    return { available: false, hasWorkspace: false };
  }
  try {
    // A bounded probe keeps an unexpected incomplete implementation from leaving the action
    // pending forever. Unlike the known Firefox route above, a timeout fails closed because it
    // could otherwise hide an existing OPFS workspace behind a newly selected empty backend.
    const originRoot = await within(navigator.storage.getDirectory(), 750);
    try {
      const workspaceRoot = await originRoot.getDirectoryHandle(workspaceDirectory);
      const adapter = new OpfsStorageAdapter(workspaceRoot);
      return {
        adapter,
        available: true,
        hasWorkspace: Boolean(await adapter.read('dusori.json')),
      };
    } catch (error) {
      if (isNotFound(error)) return { available: true, hasWorkspace: false };
      throw error;
    }
  } catch (error) {
    if (error instanceof OpfsProbeTimeoutError) {
      throw new BrowserStorageSelectionError(
        'unavailable',
        'Private file storage did not respond. Dusori stopped before opening another backend so an existing workspace cannot be hidden. Try again in this browser.',
      );
    }
    return { available: false, hasWorkspace: false };
  }
}

async function inspectIndexedDb(
  workspaceDirectory: string,
  recorded: BrowserStorageBackend | null,
): Promise<BrowserStorageInspection> {
  if (typeof indexedDB === 'undefined') return { available: false, hasWorkspace: false };
  const exists =
    recorded === 'indexeddb' || (await indexedDbWorkspaceDatabaseExists(workspaceDirectory));
  if (!exists) return { available: true, hasWorkspace: false };
  try {
    const adapter = await IndexedDbStorageAdapter.open(workspaceDirectory);
    return {
      adapter,
      available: true,
      hasWorkspace: Boolean(await adapter.read('dusori.json')),
    };
  } catch {
    return { available: false, hasWorkspace: false };
  }
}

async function inspectBrowserStorage(workspaceDirectory: string): Promise<{
  indexeddb: BrowserStorageInspection;
  opfs: BrowserStorageInspection;
  recorded: BrowserStorageBackend | null;
}> {
  const recorded = readBackendMarker();
  const [opfs, indexeddb] = await Promise.all([
    inspectOpfs(workspaceDirectory),
    inspectIndexedDb(workspaceDirectory, recorded),
  ]);
  return { indexeddb, opfs, recorded };
}

/**
 * Reopens only a browser backend that already contains a workspace. This performs no fallback
 * creation during page load and therefore never turns a capability probe into hidden user data.
 */
export async function openBrowserStorage(
  workspaceDirectory = 'Dusori',
): Promise<BrowserStorageAdapter | null> {
  const inspected = await inspectBrowserStorage(workspaceDirectory);
  const backend = selectBrowserStorageBackend(
    inspected.recorded,
    inspected.opfs,
    inspected.indexeddb,
    { create: false },
  );
  if (!backend) return null;
  const adapter = inspected[backend].adapter;
  if (!adapter) {
    throw new BrowserStorageSelectionError(
      'unavailable',
      'Dusori found a browser workspace but could not open its local storage. No other backend was substituted.',
    );
  }
  writeBackendMarker(backend);
  return adapter;
}

/**
 * Creates or reuses one stable, device-local browser backend. OPFS remains preferred where it
 * works; IndexedDB is the no-account, no-egress fallback for browsers whose OPFS call fails.
 */
export async function createBrowserStorage(
  workspaceDirectory = 'Dusori',
): Promise<BrowserStorageAdapter> {
  const inspected = await inspectBrowserStorage(workspaceDirectory);
  const backend = selectBrowserStorageBackend(
    inspected.recorded,
    inspected.opfs,
    inspected.indexeddb,
    { create: true },
  );
  if (!backend) {
    throw new BrowserStorageSelectionError(
      'unavailable',
      'This browser could not open private local storage. No workspace was created.',
    );
  }
  const adapter =
    inspected[backend].adapter ??
    (backend === 'opfs'
      ? await createOpfsStorage(workspaceDirectory)
      : await IndexedDbStorageAdapter.open(workspaceDirectory));
  if (!writeBackendMarker(backend)) {
    throw new BrowserStorageSelectionError(
      'unavailable',
      'This browser could not remember which private storage backend owns the workspace. No workspace files were created.',
    );
  }
  return adapter;
}
