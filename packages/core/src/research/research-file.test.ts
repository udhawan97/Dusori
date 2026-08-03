import { describe, expect, it } from 'vitest';

import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace } from '../workspace/create.js';
import { readResearchFile, recordResearchRun, type ResearchRunInput } from './research-file.js';

const now = new Date('2026-08-02T10:00:00.000Z');

async function topicStorage(): Promise<MemoryStorageAdapter> {
  const storage = new MemoryStorageAdapter();
  await createWorkspace(storage, 'Dusori', now);
  await createTopic(storage, 'Spaced repetition learning', now);
  return storage;
}

function run(overrides: Partial<ResearchRunInput> = {}): ResearchRunInput {
  return {
    candidates: [{ key: 'wikipedia:1', url: 'https://en.wikipedia.org/wiki/Spaced_repetition' }],
    providers: [{ count: 1, id: 'wikipedia', label: 'Wikipedia', outcome: 'found' }],
    searchText: 'Spaced repetition learning',
    ...overrides,
  };
}

describe('research run ledger', () => {
  it('persists a run with per-provider outcomes and counts new keys', async () => {
    const storage = await topicStorage();

    await recordResearchRun(storage, 'spaced-repetition-learning', run(), now);

    const file = await readResearchFile(storage, 'spaced-repetition-learning', now);
    expect(file?.lastRunAt).toBe(now.toISOString());
    expect(file?.runs).toHaveLength(1);
    expect(file?.runs?.[0]).toMatchObject({
      at: now.toISOString(),
      newKeys: 1,
      providers: [{ count: 1, id: 'wikipedia', label: 'Wikipedia', outcome: 'found' }],
      searchText: 'Spaced repetition learning',
    });
  });

  it('records a run in which every provider failed, with zero candidates', async () => {
    const storage = await topicStorage();

    await recordResearchRun(
      storage,
      'spaced-repetition-learning',
      run({
        candidates: [],
        providers: [
          {
            count: 0,
            id: 'wikipedia',
            label: 'Wikipedia',
            message: 'Wikipedia took too long to answer and was skipped.',
            outcome: 'failed',
          },
        ],
      }),
      now,
    );

    const file = await readResearchFile(storage, 'spaced-repetition-learning', now);
    expect(file?.runs?.[0]?.providers[0]).toMatchObject({
      message: 'Wikipedia took too long to answer and was skipped.',
      outcome: 'failed',
    });
    expect(file?.runs?.[0]?.newKeys).toBe(0);
    expect(file?.seen ?? []).toHaveLength(0);
  });

  it('counts only genuinely new keys and keeps first-seen timestamps', async () => {
    const storage = await topicStorage();

    await recordResearchRun(storage, 'spaced-repetition-learning', run(), now);
    const later = new Date('2026-08-02T11:00:00.000Z');
    await recordResearchRun(
      storage,
      'spaced-repetition-learning',
      run({ candidates: [{ key: 'wikipedia:1' }, { key: 'wikipedia:2' }] }),
      later,
    );

    const file = await readResearchFile(storage, 'spaced-repetition-learning', later);
    expect(file?.runs?.[1]?.newKeys).toBe(1);
    const first = file?.seen?.find((entry) => entry.key === 'wikipedia:1');
    expect(first?.at).toBe(now.toISOString());
  });

  it('drops the oldest run beyond fifty', async () => {
    const storage = await topicStorage();

    for (let index = 0; index < 51; index += 1) {
      await recordResearchRun(
        storage,
        'spaced-repetition-learning',
        run({ candidates: [], providers: [], searchText: `query ${index}` }),
        new Date(now.getTime() + index * 60_000),
      );
    }

    const file = await readResearchFile(storage, 'spaced-repetition-learning', now);
    expect(file?.runs).toHaveLength(50);
    expect(file?.runs?.[0]?.searchText).toBe('query 1');
    expect(file?.runs?.at(-1)?.searchText).toBe('query 50');
  });
});
