import {
  StorageConflictError,
  normalizeWorkspacePath,
  sha256,
  type FileSnapshot,
  type StorageAdapter,
  type StorageEntry,
  type WriteOptions,
} from '@dusori/core';

const storeName = 'entries';

interface IndexedDbEntry {
  content?: string;
  kind: StorageEntry['kind'];
  modifiedAt: number;
}

function databaseName(workspaceDirectory: string): string {
  return `dusori-browser-workspace-v1:${workspaceDirectory}`;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function openDatabase(workspaceDirectory: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName(workspaceDirectory), 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function parentDirectories(path: string): string[] {
  const segments = path.split('/');
  segments.pop();
  return segments.map((_, index) => segments.slice(0, index + 1).join('/'));
}

export async function indexedDbWorkspaceDatabaseExists(
  workspaceDirectory = 'Dusori',
): Promise<boolean> {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return false;
  try {
    const databases = await indexedDB.databases();
    return databases.some((database) => database.name === databaseName(workspaceDirectory));
  } catch {
    return false;
  }
}

export class IndexedDbStorageAdapter implements StorageAdapter {
  readonly kind = 'indexeddb' as const;

  private constructor(private readonly database: IDBDatabase) {}

  static async open(workspaceDirectory = 'Dusori'): Promise<IndexedDbStorageAdapter> {
    return new IndexedDbStorageAdapter(await openDatabase(workspaceDirectory));
  }

  async ensureDirectory(path: string): Promise<void> {
    const normalized = normalizeWorkspacePath(path);
    if (!normalized) return;
    const transaction = this.database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const timestamp = Date.now();
    for (const directory of [...parentDirectories(normalized), normalized]) {
      store.put({ kind: 'directory', modifiedAt: timestamp } satisfies IndexedDbEntry, directory);
    }
    await transactionComplete(transaction);
  }

  async list(path = '', recursive = false): Promise<StorageEntry[]> {
    const normalized = normalizeWorkspacePath(path);
    const transaction = this.database.transaction(storeName);
    const completed = transactionComplete(transaction);
    const store = transaction.objectStore(storeName);
    const [keys, values] = await Promise.all([
      requestResult(store.getAllKeys()),
      requestResult(store.getAll() as IDBRequest<IndexedDbEntry[]>),
    ]);
    await completed;
    const prefix = normalized ? `${normalized}/` : '';
    const entries = new Map<string, StorageEntry['kind']>();
    keys.forEach((key, index) => {
      if (typeof key !== 'string' || key === normalized || !key.startsWith(prefix)) return;
      const relative = key.slice(prefix.length);
      if (!relative) return;
      if (recursive) {
        entries.set(key, values[index]?.kind ?? 'file');
        return;
      }
      const [first] = relative.split('/');
      const entryPath = prefix + first;
      entries.set(
        entryPath,
        relative.includes('/') ? 'directory' : (values[index]?.kind ?? 'file'),
      );
    });
    return [...entries]
      .map(([entryPath, kind]) => ({ kind, path: entryPath }))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  async move(from: string, to: string): Promise<void> {
    const source = await this.read(from);
    if (!source) throw new Error(`Missing file: ${from}`);
    await this.write(to, source.content, { expectedHash: null });
    await this.remove(from);
  }

  async read(path: string): Promise<FileSnapshot | null> {
    const normalized = normalizeWorkspacePath(path);
    const transaction = this.database.transaction(storeName);
    const completed = transactionComplete(transaction);
    const entry = await requestResult(
      transaction.objectStore(storeName).get(normalized) as IDBRequest<IndexedDbEntry | undefined>,
    );
    await completed;
    if (!entry || entry.kind !== 'file' || entry.content === undefined) return null;
    return {
      content: entry.content,
      hash: await sha256(entry.content),
      modifiedAt: entry.modifiedAt,
      path: normalized,
    };
  }

  async remove(path: string, recursive = false): Promise<void> {
    const normalized = normalizeWorkspacePath(path);
    const transaction = this.database.transaction(storeName, 'readwrite');
    const completed = transactionComplete(transaction);
    const store = transaction.objectStore(storeName);
    const keys = await requestResult(store.getAllKeys());
    const descendants = keys.filter(
      (key): key is string => typeof key === 'string' && key.startsWith(`${normalized}/`),
    );
    if (descendants.length > 0 && !recursive) {
      throw new Error(`Directory is not empty: ${normalized}`);
    }
    store.delete(normalized);
    if (recursive) descendants.forEach((key) => store.delete(key));
    await completed;
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
    const transaction = this.database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const modifiedAt = Date.now();
    for (const directory of parentDirectories(normalized)) {
      store.put({ kind: 'directory', modifiedAt } satisfies IndexedDbEntry, directory);
    }
    store.put({ content, kind: 'file', modifiedAt } satisfies IndexedDbEntry, normalized);
    await transactionComplete(transaction);
    return {
      content,
      hash: await sha256(content),
      modifiedAt,
      path: normalized,
    };
  }
}
