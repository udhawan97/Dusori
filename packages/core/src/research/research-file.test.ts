import { describe, expect, it } from 'vitest';

import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace } from '../workspace/create.js';
import {
  isMissionStale,
  readResearchFile,
  recordResearchRun,
  recordResearchSynthesisOutcome,
  setAutoRefresh,
  setResearchOutputStyle,
  type ResearchRunInput,
} from './research-file.js';

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
    questionText: 'How does spaced repetition support learning?',
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
      eligibleCount: 1,
      newKeys: 1,
      providers: [{ count: 1, id: 'wikipedia', label: 'Wikipedia', outcome: 'found' }],
      questionText: 'How does spaced repetition support learning?',
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
    expect(file?.runs?.[0]?.eligibleCount).toBe(0);
    expect(file?.seen ?? []).toHaveLength(0);
  });

  it('keeps an edited synthesis bound to its earlier run when a later run only proposes', async () => {
    const storage = await topicStorage();
    await recordResearchRun(storage, 'spaced-repetition-learning', run(), now);
    await recordResearchSynthesisOutcome(
      storage,
      'spaced-repetition-learning',
      now.toISOString(),
      'written',
      now,
    );
    const later = new Date('2026-08-02T11:00:00.000Z');
    await recordResearchRun(
      storage,
      'spaced-repetition-learning',
      run({ questionText: 'Should this answer change?', searchText: 'Should this answer change?' }),
      later,
    );
    const file = await recordResearchSynthesisOutcome(
      storage,
      'spaced-repetition-learning',
      later.toISOString(),
      'proposed',
      later,
    );

    expect(file.synthesisRunAt).toBe(now.toISOString());
    expect(file.runs?.map((item) => item.synthesisOutcome)).toEqual(['written', 'proposed']);
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

  it('stores the standing refresh permission without touching the trail', async () => {
    const storage = await topicStorage();
    await recordResearchRun(storage, 'spaced-repetition-learning', run(), now);

    await setAutoRefresh(storage, 'spaced-repetition-learning', true, now);

    const file = await readResearchFile(storage, 'spaced-repetition-learning', now);
    expect(file?.autoRefresh).toBe(true);
    expect(file?.runs).toHaveLength(1);
    expect(file?.seen).toHaveLength(1);
  });

  it('stores the synthesis structure without touching the research trail', async () => {
    const storage = await topicStorage();
    await recordResearchRun(storage, 'spaced-repetition-learning', run(), now);

    await setResearchOutputStyle(storage, 'spaced-repetition-learning', 'study-guide', now);

    const file = await readResearchFile(storage, 'spaced-repetition-learning', now);
    expect(file?.outputStyle).toBe('study-guide');
    expect(file?.runs).toHaveLength(1);
    expect(file?.seen).toHaveLength(1);
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

describe('stale mission detection', () => {
  const eightDaysLater = new Date('2026-08-10T10:00:00.000Z');

  it('never treats an unarmed topic as stale, however old', () => {
    const file = { autoRefresh: false, lastRunAt: now.toISOString() } as never;
    expect(isMissionStale(file, eightDaysLater)).toBe(false);
    expect(isMissionStale(null, eightDaysLater)).toBe(false);
  });

  // A topic that has never been scanned has nothing to refresh, so the first run stays a
  // choice the learner makes rather than something opening the app does for them.
  it('never treats a never-scanned topic as stale', () => {
    expect(isMissionStale({ autoRefresh: true } as never, eightDaysLater)).toBe(false);
  });

  it('is stale only once an armed topic passes the window', () => {
    const file = { autoRefresh: true, lastRunAt: now.toISOString() } as never;

    expect(isMissionStale(file, now)).toBe(false);
    expect(isMissionStale(file, new Date('2026-08-08T09:00:00.000Z'))).toBe(false);
    expect(isMissionStale(file, eightDaysLater)).toBe(true);
  });
});
