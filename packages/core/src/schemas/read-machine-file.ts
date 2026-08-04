import type { z } from 'zod';

import type { StorageAdapter } from '../adapters.js';
import { safeTimestamp } from '../workspace/paths.js';

export type MachineFilePreflight<T> =
  | { data: T; path: string; status: 'valid' }
  | { error: unknown; path: string; status: 'invalid' }
  | { path: string; status: 'missing' };

/**
 * Validate a machine-owned JSON file without changing it. Repair and quarantine are separate,
 * explicit operations so a malformed file never disappears while a learner is only opening or
 * inspecting a workspace.
 */
export async function preflightMachineFile<T>(
  storage: StorageAdapter,
  path: string,
  schema: z.ZodType<T>,
): Promise<MachineFilePreflight<T>> {
  const snapshot = await storage.read(path);
  if (!snapshot) return { path, status: 'missing' };

  try {
    return { data: schema.parse(JSON.parse(snapshot.content)), path, status: 'valid' };
  } catch (error) {
    return { error, path, status: 'invalid' };
  }
}

export async function readMachineFile<T>(
  storage: StorageAdapter,
  path: string,
  schema: z.ZodType<T>,
  now = new Date(),
): Promise<T> {
  // Retained for API compatibility with v0.11.3 callers; reads no longer use time to auto-move.
  void now;
  const result = await preflightMachineFile(storage, path, schema);
  if (result.status === 'missing') throw new Error(`Required machine file is missing: ${path}`);
  if (result.status === 'invalid') {
    throw new Error(
      `Invalid machine file preserved at ${path}. Review it before choosing repair or quarantine.`,
      { cause: result.error },
    );
  }
  return result.data;
}

/** Move a file only after the caller has explicitly chosen to quarantine invalid data. */
export async function quarantineInvalidMachineFile<T>(
  storage: StorageAdapter,
  path: string,
  schema: z.ZodType<T>,
  now = new Date(),
): Promise<string> {
  const result = await preflightMachineFile(storage, path, schema);
  if (result.status === 'missing') throw new Error(`Required machine file is missing: ${path}`);
  if (result.status === 'valid')
    throw new Error(`Machine file is valid and was not moved: ${path}`);
  const invalidPath = `${path}.invalid-${safeTimestamp(now)}`;
  await storage.move(path, invalidPath);
  return invalidPath;
}
