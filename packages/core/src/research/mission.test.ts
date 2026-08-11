import { describe, expect, it } from 'vitest';

import { addSource } from '../sources/import.js';
import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace } from '../workspace/create.js';
import {
  deriveMissionOverview,
  failedProvidersOnLastRun,
  lensFor,
  missionAgeInDays,
} from './mission.js';
import { researchProviderPolicy } from './providers/index.js';
import { recordResearchRun } from './research-file.js';

const now = new Date('2026-08-02T10:00:00.000Z');
const slug = 'spaced-repetition-learning';

async function topicStorage(): Promise<MemoryStorageAdapter> {
  const storage = new MemoryStorageAdapter();
  await createWorkspace(storage, 'Dusori', now);
  await createTopic(storage, 'Spaced repetition learning', now);
  return storage;
}

describe('mission overview', () => {
  it('assigns every registered provider to a known lens', () => {
    for (const provider of researchProviderPolicy.entries) {
      expect(['academic', 'books', 'community', 'docs', 'video', 'web']).toContain(
        lensFor(provider.id),
      );
    }
  });

  it('files an unrecognised provider under web rather than dropping it', () => {
    expect(lensFor('somebody-new')).toBe('web');
  });

  it('derives zeroed state for a topic that never ran research', async () => {
    const storage = await topicStorage();

    expect(await deriveMissionOverview(storage, slug, now)).toEqual({
      claimCount: 0,
      discovered: 0,
      lastRun: null,
      lastRunAt: null,
      lensCounts: { academic: 0, books: 0, community: 0, docs: 0, video: 0, web: 0 },
      readSources: 0,
      runCount: 0,
      savedSources: 0,
      topicSlug: slug,
    });
  });

  it('keeps scholarly metadata and book records in their truthful lenses', () => {
    expect(lensFor('crossref')).toBe('academic');
    expect(lensFor('openlibrary')).toBe('books');
  });

  it('counts saved sources per lens and reports the last run', async () => {
    const storage = await topicStorage();
    await addSource(storage, {
      content: '# Extract',
      method: 'url',
      origin: { capturedAt: now.toISOString(), capturedVia: 'api-extract', provider: 'wikipedia' },
      title: 'Spaced repetition',
      topicSlug: slug,
      url: 'https://en.wikipedia.org/wiki/Spaced_repetition',
    });
    await recordResearchRun(
      storage,
      slug,
      {
        candidates: [{ key: 'wikipedia:1' }],
        providers: [
          { count: 1, id: 'wikipedia', label: 'Wikipedia', outcome: 'found' },
          { count: 0, id: 'github', label: 'GitHub', message: 'boom', outcome: 'failed' },
        ],
        searchText: 'Spaced repetition learning',
      },
      now,
    );

    const mission = await deriveMissionOverview(storage, slug, now);

    expect(mission.savedSources).toBe(1);
    expect(mission.discovered).toBe(1);
    expect(mission.runCount).toBe(1);
    expect(mission.lensCounts.docs).toBe(1);
    expect(mission.lensCounts.academic).toBe(0);
    expect(mission.lastRunAt).toBe(now.toISOString());
    expect(failedProvidersOnLastRun(mission)).toEqual(['GitHub']);
  });

  it('reports mission age in whole days and null when never scanned', async () => {
    const storage = await topicStorage();
    const fresh = await deriveMissionOverview(storage, slug, now);
    expect(missionAgeInDays(fresh, now)).toBeNull();

    await recordResearchRun(
      storage,
      slug,
      { candidates: [], providers: [], searchText: 'query' },
      now,
    );
    const scanned = await deriveMissionOverview(storage, slug, now);

    expect(missionAgeInDays(scanned, now)).toBe(0);
    expect(missionAgeInDays(scanned, new Date('2026-08-10T10:00:00.000Z'))).toBe(8);
  });
});
