import { z } from 'zod';

import { StorageConflictError, type StorageAdapter } from '../adapters.js';
import { readMachineFile } from '../schemas/read-machine-file.js';
import { TopicStateSchema, schemaVersion } from '../schemas/workspace.js';
import { topicRoot } from '../workspace/paths.js';

export const DismissedResearchSuggestionSchema = z.object({
  key: z.string().min(1).max(320),
  title: z.string().min(1).max(160),
  at: z.string().datetime(),
});

export const ResearchFileSchema = z.object({
  schemaVersion: z.literal(schemaVersion),
  topicSlug: z.string().min(1).max(80),
  dismissed: z.array(DismissedResearchSuggestionSchema),
});

export type DismissedResearchSuggestion = z.infer<typeof DismissedResearchSuggestionSchema>;
export type ResearchFile = z.infer<typeof ResearchFileSchema>;

export function researchFilePath(topicSlug: string): string {
  return `${topicRoot(topicSlug)}/research.json`;
}

export async function readResearchFile(
  storage: StorageAdapter,
  topicSlug: string,
  now = new Date(),
): Promise<ResearchFile | null> {
  const root = topicRoot(topicSlug);
  await readMachineFile(storage, `${root}/state.json`, TopicStateSchema, now);
  const path = `${root}/research.json`;
  if (!(await storage.read(path))) return null;
  return readMachineFile(storage, path, ResearchFileSchema, now);
}

export async function writeDismissedResearchSuggestion(
  storage: StorageAdapter,
  topicSlug: string,
  suggestion: { key: string; title: string },
  now = new Date(),
): Promise<ResearchFile> {
  const normalizedSlug = topicRoot(topicSlug).slice('Topics/'.length);
  const path = researchFilePath(topicSlug);
  await readMachineFile(storage, `${topicRoot(topicSlug)}/state.json`, TopicStateSchema, now);
  const dismissal = DismissedResearchSuggestionSchema.parse({
    at: now.toISOString(),
    key: suggestion.key,
    title: suggestion.title,
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const currentSnapshot = await storage.read(path);
    const current = currentSnapshot
      ? await readMachineFile(storage, path, ResearchFileSchema, now)
      : ResearchFileSchema.parse({ dismissed: [], schemaVersion, topicSlug: normalizedSlug });
    if (current.dismissed.some((item) => item.key === dismissal.key)) return current;
    const next = ResearchFileSchema.parse({
      ...current,
      dismissed: [...current.dismissed, dismissal],
    });
    try {
      await storage.write(path, `${JSON.stringify(next, null, 2)}\n`, {
        expectedHash: currentSnapshot?.hash ?? null,
      });
      return next;
    } catch (error) {
      if (!(error instanceof StorageConflictError) || attempt === 2) throw error;
    }
  }

  throw new Error('Research dismissals changed repeatedly. Try dismissing this suggestion again.');
}
