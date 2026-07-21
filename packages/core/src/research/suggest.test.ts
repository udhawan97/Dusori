import { describe, expect, it, vi } from 'vitest';

import { addSource } from '../sources/import.js';
import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace } from '../workspace/create.js';
import type { ResearchCandidate } from './types.js';
import { dismissSuggestion, filterResearchSuggestions, readDismissed } from './suggest.js';

const now = new Date('2026-07-20T15:30:00.000Z');

async function topicStorage(): Promise<MemoryStorageAdapter> {
  const storage = new MemoryStorageAdapter();
  await createWorkspace(storage, 'Dusori', now);
  await createTopic(storage, 'Azure administration', now);
  return storage;
}

function candidate(overrides: Partial<ResearchCandidate>): ResearchCandidate {
  return {
    key: 'wikipedia:1',
    meta: {},
    provider: 'wikipedia',
    score: 4,
    snippet: 'Identity and access management.',
    title: 'Identity management',
    url: 'https://en.wikipedia.org/wiki/Identity_management',
    ...overrides,
  };
}

describe('research suggestions', () => {
  it('reads no dismissals until the first one is stored', async () => {
    const storage = await topicStorage();

    expect(await readDismissed(storage, 'azure-administration', now)).toEqual([]);
    expect(await storage.read('Topics/azure-administration/research.json')).toBeNull();
  });

  it('round-trips dismissals and merges a competing hash-guarded write', async () => {
    const storage = await topicStorage();
    const path = 'Topics/azure-administration/research.json';
    const originalWrite = storage.write.bind(storage);
    let injectedConflict = false;
    vi.spyOn(storage, 'write').mockImplementation(async (writePath, content, options) => {
      if (writePath === path && !injectedConflict) {
        injectedConflict = true;
        await storage.externalWrite(
          path,
          `${JSON.stringify(
            {
              dismissed: [
                { at: '2026-07-20T15:29:00.000Z', key: 'mslearn:concurrent', title: 'Concurrent' },
              ],
              schemaVersion: 1,
              topicSlug: 'azure-administration',
            },
            null,
            2,
          )}\n`,
        );
      }
      return originalWrite(writePath, content, options);
    });

    await dismissSuggestion(
      storage,
      'azure-administration',
      { key: 'wikipedia:42', title: 'Microsoft Entra ID' },
      now,
    );

    expect(await readDismissed(storage, 'azure-administration', now)).toEqual([
      { at: '2026-07-20T15:29:00.000Z', key: 'mslearn:concurrent', title: 'Concurrent' },
      { at: now.toISOString(), key: 'wikipedia:42', title: 'Microsoft Entra ID' },
    ]);
  });

  it('drops saved URLs and dismissed keys while preserving candidate order', async () => {
    const storage = await topicStorage();
    await addSource(
      storage,
      {
        method: 'url',
        title: 'Saved module',
        topicSlug: 'azure-administration',
        url: 'https://learn.microsoft.com/training/modules/saved/',
      },
      now,
    );
    await dismissSuggestion(
      storage,
      'azure-administration',
      { key: 'wikipedia:2', title: 'Dismissed article' },
      now,
    );

    const remaining = await filterResearchSuggestions(
      storage,
      'azure-administration',
      [
        candidate({
          key: 'mslearn:saved',
          provider: 'mslearn',
          url: 'https://learn.microsoft.com/training/modules/saved/',
        }),
        candidate({ key: 'wikipedia:2', title: 'Dismissed article' }),
        candidate({ key: 'wikipedia:3', title: 'Keep first' }),
        candidate({ key: 'wikipedia:4', title: 'Keep second' }),
      ],
      now,
    );

    expect(remaining.map((item) => item.title)).toEqual(['Keep first', 'Keep second']);
  });

  it('drops a ranked-search candidate whose URL was dismissed under its catalog-style key', async () => {
    const storage = await topicStorage();
    const url = 'https://learn.microsoft.com/training/modules/entra-id/';
    await dismissSuggestion(
      storage,
      'azure-administration',
      { key: 'mslearn:entra-id', title: 'Entra ID module', url },
      now,
    );

    const remaining = await filterResearchSuggestions(
      storage,
      'azure-administration',
      [candidate({ key: `mslearn:${url}`, provider: 'mslearn', title: 'Entra ID module', url })],
      now,
    );

    expect(remaining).toEqual([]);
  });

  it('drops a catalog candidate whose URL was dismissed under its ranked-search-style key', async () => {
    const storage = await topicStorage();
    const url = 'https://learn.microsoft.com/training/modules/entra-id/';
    await dismissSuggestion(
      storage,
      'azure-administration',
      { key: `mslearn:${url}`, title: 'Entra ID module', url },
      now,
    );

    const remaining = await filterResearchSuggestions(
      storage,
      'azure-administration',
      [candidate({ key: 'mslearn:entra-id', provider: 'mslearn', title: 'Entra ID module', url })],
      now,
    );

    expect(remaining).toEqual([]);
  });

  it('still filters a legacy dismissal that has no url field by key alone', async () => {
    const storage = await topicStorage();
    const path = 'Topics/azure-administration/research.json';
    await storage.write(
      path,
      `${JSON.stringify(
        {
          dismissed: [{ at: now.toISOString(), key: 'wikipedia:legacy', title: 'Legacy entry' }],
          schemaVersion: 1,
          topicSlug: 'azure-administration',
        },
        null,
        2,
      )}\n`,
      { expectedHash: null },
    );

    const remaining = await filterResearchSuggestions(
      storage,
      'azure-administration',
      [candidate({ key: 'wikipedia:legacy', title: 'Legacy entry' })],
      now,
    );

    expect(remaining).toEqual([]);
  });
});
