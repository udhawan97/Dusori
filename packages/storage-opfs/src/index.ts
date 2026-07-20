import {
  StorageConflictError,
  normalizeWorkspacePath,
  sha256,
  type FileSnapshot,
  type StorageAdapter,
  type StorageEntry,
  type WriteOptions,
} from '@dusori/core';

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
  await navigator.storage.persist();
  return new OpfsStorageAdapter(workspaceRoot);
}
