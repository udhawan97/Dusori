import {
  StorageConflictError,
  type FileSnapshot,
  type StorageAdapter,
  type StorageEntry,
  type WriteOptions,
} from '../adapters.js';
import { sha256 } from '../hash.js';
import { normalizeWorkspacePath } from '../workspace/paths.js';

interface MemoryFile {
  content: string;
  modifiedAt: number;
}

export class MemoryStorageAdapter implements StorageAdapter {
  readonly kind = 'memory' as const;
  readonly files = new Map<string, MemoryFile>();
  readonly directories = new Set<string>(['']);
  private clock = 1;

  async ensureDirectory(path: string): Promise<void> {
    const normalized = normalizeWorkspacePath(path);
    let current = '';
    for (const segment of normalized.split('/').filter(Boolean)) {
      current = current ? `${current}/${segment}` : segment;
      this.directories.add(current);
    }
  }

  async list(path = '', recursive = false): Promise<StorageEntry[]> {
    const normalized = normalizeWorkspacePath(path);
    const prefix = normalized ? `${normalized}/` : '';
    const entries: StorageEntry[] = [];
    for (const directory of this.directories) {
      if (!directory || !directory.startsWith(prefix) || directory === normalized) continue;
      const remainder = directory.slice(prefix.length);
      if (recursive || !remainder.includes('/'))
        entries.push({ kind: 'directory', path: directory });
    }
    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) continue;
      const remainder = file.slice(prefix.length);
      if (recursive || !remainder.includes('/')) entries.push({ kind: 'file', path: file });
    }
    return entries.sort((left, right) => left.path.localeCompare(right.path));
  }

  async move(from: string, to: string): Promise<void> {
    const source = normalizeWorkspacePath(from);
    const destination = normalizeWorkspacePath(to);
    const file = this.files.get(source);
    if (!file) throw new Error(`Missing file: ${source}`);
    await this.ensureDirectory(
      destination.includes('/') ? destination.slice(0, destination.lastIndexOf('/')) : '',
    );
    this.files.set(destination, file);
    this.files.delete(source);
  }

  async read(path: string): Promise<FileSnapshot | null> {
    const normalized = normalizeWorkspacePath(path);
    const file = this.files.get(normalized);
    if (!file) return null;
    return {
      content: file.content,
      hash: await sha256(file.content),
      modifiedAt: file.modifiedAt,
      path: normalized,
    };
  }

  async remove(path: string, recursive = false): Promise<void> {
    const normalized = normalizeWorkspacePath(path);
    if (this.files.delete(normalized)) return;
    const prefix = `${normalized}/`;
    const hasChildren = [...this.files.keys(), ...this.directories].some((entry) =>
      entry.startsWith(prefix),
    );
    if (hasChildren && !recursive) throw new Error(`Directory is not empty: ${normalized}`);
    for (const file of this.files.keys()) if (file.startsWith(prefix)) this.files.delete(file);
    for (const directory of this.directories) {
      if (directory === normalized || directory.startsWith(prefix))
        this.directories.delete(directory);
    }
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
    const parent = normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) : '';
    await this.ensureDirectory(parent);
    this.files.set(normalized, { content, modifiedAt: this.clock++ });
    return (await this.read(normalized))!;
  }

  async externalWrite(path: string, content: string): Promise<void> {
    const normalized = normalizeWorkspacePath(path);
    const parent = normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) : '';
    await this.ensureDirectory(parent);
    this.files.set(normalized, { content, modifiedAt: this.clock++ });
  }
}
