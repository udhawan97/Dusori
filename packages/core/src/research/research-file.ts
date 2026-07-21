import { z } from 'zod';

import { StorageConflictError, type StorageAdapter } from '../adapters.js';
import { readMachineFile } from '../schemas/read-machine-file.js';
import { TopicStateSchema, schemaVersion } from '../schemas/workspace.js';
import { topicRoot } from '../workspace/paths.js';

export const DismissedResearchSuggestionSchema = z.object({
  key: z.string().min(1).max(320),
  title: z.string().min(1).max(160),
  at: z.string().datetime(),
  // Optional: a catalog candidate is keyed `mslearn:<uid>`, a ranked-search
  // candidate `mslearn:<url>` (the ranked API returns no uid). The URL is the
  // one thing stable across both, so it's kept alongside the key to match a
  // dismissal regardless of which path produced the candidate.
  url: z.url().max(2048).optional(),
});

export const ResearchFileSchema = z.object({
  schemaVersion: z.literal(schemaVersion),
  topicSlug: z.string().min(1).max(80),
  dismissed: z.array(DismissedResearchSuggestionSchema),
});

export type DismissedResearchSuggestion = z.infer<typeof DismissedResearchSuggestionSchema>;
export type ResearchFile = z.infer<typeof ResearchFileSchema>;

// Normalizes a URL for comparison so equivalent references (e.g. differing
// only in how the URL constructor formats them) match. Falls back to the raw
// string for anything unparseable rather than throwing.
export function canonicalUrl(url: string): string {
  try {
    return new URL(url).toString();
  } catch {
    return url;
  }
}

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
  suggestion: { key: string; title: string; url?: string },
  now = new Date(),
): Promise<ResearchFile> {
  const normalizedSlug = topicRoot(topicSlug).slice('Topics/'.length);
  const path = researchFilePath(topicSlug);
  await readMachineFile(storage, `${topicRoot(topicSlug)}/state.json`, TopicStateSchema, now);
  const dismissal = DismissedResearchSuggestionSchema.parse({
    at: now.toISOString(),
    key: suggestion.key,
    title: suggestion.title,
    url: suggestion.url,
  });
  const dismissalUrl = dismissal.url ? canonicalUrl(dismissal.url) : null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const currentSnapshot = await storage.read(path);
    const current = currentSnapshot
      ? await readMachineFile(storage, path, ResearchFileSchema, now)
      : ResearchFileSchema.parse({ dismissed: [], schemaVersion, topicSlug: normalizedSlug });
    const alreadyDismissed = current.dismissed.some(
      (item) =>
        item.key === dismissal.key ||
        (dismissalUrl !== null &&
          item.url !== undefined &&
          canonicalUrl(item.url) === dismissalUrl),
    );
    if (alreadyDismissed) return current;
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
