import type { StorageAdapter } from '../adapters.js';
import { readSourceManifest } from '../sources/import.js';
import {
  readResearchFile,
  writeDismissedResearchSuggestion,
  type DismissedResearchSuggestion,
  type ResearchFile,
} from './research-file.js';
import type { ResearchCandidate } from './types.js';

function canonicalUrl(url: string): string {
  try {
    return new URL(url).toString();
  } catch {
    return url;
  }
}

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
  suggestion: { key: string; title: string },
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
  return candidates.filter(
    (candidate) => !savedUrls.has(canonicalUrl(candidate.url)) && !dismissedKeys.has(candidate.key),
  );
}
