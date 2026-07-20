import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

import { normalizeWorkspacePath, sha256, StorageConflictError } from '@dusori/core';

function isContained(root: string, candidate: string): boolean {
  const delta = relative(root, candidate);
  return delta === '' || (!delta.startsWith(`..${sep}`) && delta !== '..' && !isAbsolute(delta));
}

export async function canonicalRoot(root: string): Promise<string> {
  const resolved = resolve(root);
  await mkdir(resolved, { recursive: true });
  return realpath(resolved);
}

async function resolveContained(root: string, path: string, forWrite = false): Promise<string> {
  const normalized = normalizeWorkspacePath(path);
  if (!normalized) return root;
  const candidate = resolve(root, normalized);
  if (!isContained(root, candidate)) throw new Error('Path escapes the selected Dusori root.');

  const boundary = forWrite ? dirname(candidate) : candidate;
  let cursor = boundary;
  while (isContained(root, cursor)) {
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink()) {
        const resolved = await realpath(cursor);
        if (!isContained(root, resolved))
          throw new Error('Symlink escapes the selected Dusori root.');
      }
      const resolved = await realpath(cursor);
      if (!isContained(root, resolved))
        throw new Error('Path resolves outside the selected Dusori root.');
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  return candidate;
}

export async function readWorkspaceFile(root: string, path: string) {
  const candidate = await resolveContained(root, path);
  const info = await stat(candidate);
  if (!info.isFile()) throw new Error('Requested path is not a file.');
  const content = await readFile(candidate, 'utf8');
  return {
    content,
    hash: await sha256(content),
    modifiedAt: info.mtimeMs,
    path: normalizeWorkspacePath(path),
  };
}

export async function listWorkspace(root: string, path = '') {
  const candidate = await resolveContained(root, path);
  const base = normalizeWorkspacePath(path);
  const entries = await readdir(candidate, { withFileTypes: true });
  return entries
    .filter((entry) => !entry.isSymbolicLink())
    .map((entry) => ({
      kind: entry.isDirectory() ? ('directory' as const) : ('file' as const),
      path: base ? `${base}/${entry.name}` : entry.name,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export async function writeWorkspaceFile(
  root: string,
  path: string,
  content: string,
  expectedHash?: string | null,
) {
  const normalized = normalizeWorkspacePath(path);
  const candidate = await resolveContained(root, normalized, true);
  await mkdir(dirname(candidate), { recursive: true });

  let currentHash: string | null = null;
  try {
    currentHash = (await readWorkspaceFile(root, normalized)).hash;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (expectedHash === null && currentHash !== null) {
    throw new StorageConflictError(normalized, null, currentHash);
  }
  if (typeof expectedHash === 'string' && currentHash !== expectedHash) {
    throw new StorageConflictError(normalized, expectedHash, currentHash);
  }

  const temporary = `${candidate}.dusori-${randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  try {
    await rename(temporary, candidate);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return readWorkspaceFile(root, normalized);
}
