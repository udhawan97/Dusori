import type { SourceRecord } from './schemas/workspace.js';

export type StorageKind = 'memory' | 'opfs' | 'fsa' | 'companion';

export interface FileSnapshot {
  content: string;
  hash: string;
  modifiedAt: number;
  path: string;
}

export interface StorageEntry {
  kind: 'directory' | 'file';
  path: string;
}

export interface WriteOptions {
  expectedHash?: string | null;
}

export interface StorageAdapter {
  readonly kind: StorageKind;
  ensureDirectory(path: string): Promise<void>;
  list(path?: string, recursive?: boolean): Promise<StorageEntry[]>;
  move(from: string, to: string): Promise<void>;
  read(path: string): Promise<FileSnapshot | null>;
  remove(path: string, recursive?: boolean): Promise<void>;
  write(path: string, content: string, options?: WriteOptions): Promise<FileSnapshot>;
}

export interface SourceAdapter {
  readonly id: string;
  import(input: unknown): Promise<SourceRecord>;
}

export interface AIProvider {
  readonly id: string;
  readonly isLocal: boolean;
  transform(sourceText: string, instructions: string): Promise<string>;
}

export class StorageConflictError extends Error {
  constructor(
    readonly path: string,
    readonly expectedHash: string | null,
    readonly actualHash: string | null,
  ) {
    super(`Storage changed before write: ${path}`);
    this.name = 'StorageConflictError';
  }
}
