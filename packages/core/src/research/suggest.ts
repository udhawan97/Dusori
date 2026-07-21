import type { StorageAdapter } from '../adapters.js';
import { readSourceManifest } from '../sources/import.js';
import {
  canonicalUrl,
  readResearchFile,
  writeDismissedResearchSuggestion,
  type DismissedResearchSuggestion,
  type ResearchFile,
} from './research-file.js';
import type { ResearchCandidate } from './types.js';

export async function readDismissed(
  storage: StorageAdapter,
  topicSlug: string,
  now = new Date(),
): Promise<DismissedResearchSuggestion[]> {
  return (await readResearchFile(storage, topicSlug, now))?.dismissed ?? [];
}

export async function dismissSuggestion(
  storage: StorageAdapter,
  topicSlug: string,
  suggestion: { key: string; title: string; url?: string },
  now = new Date(),
): Promise<ResearchFile> {
  return writeDismissedResearchSuggestion(storage, topicSlug, suggestion, now);
}

export async function filterResearchSuggestions(
  storage: StorageAdapter,
  topicSlug: string,
  candidates: ResearchCandidate[],
  now = new Date(),
): Promise<ResearchCandidate[]> {
  const [manifest, dismissed] = await Promise.all([
    readSourceManifest(storage, topicSlug, now),
    readDismissed(storage, topicSlug, now),
  ]);
  const savedUrls = new Set(
    manifest.sources.flatMap((source) => (source.url ? [canonicalUrl(source.url)] : [])),
  );
  const dismissedKeys = new Set(dismissed.map((item) => item.key));
  const dismissedUrls = new Set(
    dismissed.flatMap((item) => (item.url ? [canonicalUrl(item.url)] : [])),
  );
  return candidates.filter((candidate) => {
    const url = canonicalUrl(candidate.url);
    return !savedUrls.has(url) && !dismissedKeys.has(candidate.key) && !dismissedUrls.has(url);
  });
}
