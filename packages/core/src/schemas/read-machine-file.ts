import type { z } from 'zod';

import type { StorageAdapter } from '../adapters.js';
import { safeTimestamp } from '../workspace/paths.js';

export async function readMachineFile<T>(
  storage: StorageAdapter,
  path: string,
  schema: z.ZodType<T>,
  now = new Date(),
): Promise<T> {
  const snapshot = await storage.read(path);
  if (!snapshot) throw new Error(`Required machine file is missing: ${path}`);

  try {
    return schema.parse(JSON.parse(snapshot.content));
  } catch (error) {
    const invalidPath = `${path}.invalid-${safeTimestamp(now)}`;
    await storage.move(path, invalidPath);
    throw new Error(`Invalid machine file quarantined as ${invalidPath}`, { cause: error });
  }
}
