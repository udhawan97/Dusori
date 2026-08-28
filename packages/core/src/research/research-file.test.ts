import { describe, expect, it } from 'vitest';

import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { exportWorkspace, importWorkspace } from '../portable.js';
import { createTopic, createWorkspace } from '../workspace/create.js';
import {
  deleteResearchThread,
  isMissionStale,
  readResearchFile,
  redactResearchThread,
  recordResearchRun,
  recordResearchSynthesisOutcome,
  recordResearchThreadEvent,
  setAutoRefresh,
  setResearchOutputStyle,
  setResearchThreadFollowed,
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
  it('reads the additive P0a event model without inventing P0b fields', async () => {
    const storage = await topicStorage();
    const threadId = `thread-${'a'.repeat(24)}`;
    await storage.write(
      'Topics/spaced-repetition-learning/research.json',
      `${JSON.stringify(
        {
          activeThreadId: threadId,
          dismissed: [],
          events: [
            {
              at: now.toISOString(),
              eventId: `event-${'b'.repeat(24)}`,
              questionText: 'What is retained?',
              threadId,
              type: 'question-created',
            },
          ],
          schemaVersion: 1,
          threads: [
            {
              createdAt: now.toISOString(),
              outputStyle: 'brief',
              questionText: 'What is retained?',
              threadId,
            },
          ],
          topicSlug: 'spaced-repetition-learning',
        },
        null,
        2,
      )}\n`,
      { expectedHash: null },
    );

    const file = await readResearchFile(storage, 'spaced-repetition-learning', now);
    expect(file?.threads?.[0]?.followedAt).toBeUndefined();
    expect(file?.threadTombstones).toBeUndefined();
    expect(file?.eventTombstones).toBeUndefined();
  });

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
    expect(file?.threads).toEqual([
      expect.objectContaining({
        questionText: 'How does spaced repetition support learning?',
        threadId: file?.runs?.[0]?.threadId,
      }),
    ]);
    expect(file?.activeThreadId).toBe(file?.runs?.[0]?.threadId);
    expect(file?.events?.map((event) => event.type)).toEqual([
      'question-created',
      'research-completed',
    ]);
    expect(file?.events?.[1]).toMatchObject({
      eligibleCount: 1,
      providers: [{ count: 1, id: 'wikipedia', label: 'Wikipedia', outcome: 'found' }],
    });
  });

  it('reuses a thread for an update and gives an explicit follow-up its own parented identity', async () => {
    const storage = await topicStorage();
    const first = await recordResearchRun(storage, 'spaced-repetition-learning', run(), now);
    const parentThreadId = first.activeThreadId!;
    const updateAt = new Date('2026-08-02T11:00:00.000Z');
    const updated = await recordResearchRun(
      storage,
      'spaced-repetition-learning',
      run({ candidates: [], providers: [] }),
      updateAt,
    );
    expect(updated.threads).toHaveLength(1);
    expect(updated.runs?.map((item) => item.threadId)).toEqual([parentThreadId, parentThreadId]);

    const followUpAt = new Date('2026-08-02T12:00:00.000Z');
    const followed = await recordResearchRun(
      storage,
      'spaced-repetition-learning',
      run({
        candidates: [],
        parentThreadId,
        providers: [],
        questionText: 'Which review interval has the strongest evidence?',
        searchText: 'Spaced repetition learning strongest review interval evidence',
      }),
      followUpAt,
    );
    expect(followed.threads).toHaveLength(2);
    expect(followed.threads?.[1]).toMatchObject({
      parentThreadId,
      questionText: 'Which review interval has the strongest evidence?',
    });
    expect(followed.events?.at(-2)).toMatchObject({
      parentThreadId,
      type: 'follow-up-created',
    });
  });

  it('records bounded source, quote, and export activity without duplicating retries', async () => {
    const storage = await topicStorage();
    await recordResearchRun(storage, 'spaced-repetition-learning', run(), now);
    const sourceSha256 = 'a'.repeat(64);
    const quoteSha256 = 'b'.repeat(64);
    const manifestSha256 = 'c'.repeat(64);
    await recordResearchThreadEvent(
      storage,
      'spaced-repetition-learning',
      {
        readState: 'read',
        sourcePath: 'Topics/spaced-repetition-learning/Sources/items/source.md',
        sourceSha256,
        type: 'source-saved',
      },
      now,
    );
    await recordResearchThreadEvent(
      storage,
      'spaced-repetition-learning',
      {
        readState: 'read',
        sourcePath: 'Topics/spaced-repetition-learning/Sources/items/source.md',
        sourceSha256,
        type: 'source-saved',
      },
      now,
    );
    await recordResearchThreadEvent(
      storage,
      'spaced-repetition-learning',
      {
        notePath: 'Topics/spaced-repetition-learning/Notes/quote.md',
        quoteSha256,
        sourcePath: 'Topics/spaced-repetition-learning/Sources/items/source.md',
        sourceSha256,
        type: 'quote-added',
      },
      now,
    );
    await recordResearchThreadEvent(
      storage,
      'spaced-repetition-learning',
      {
        claimCount: 2,
        sourceContentSha256: 'd'.repeat(64),
        sourcePath: 'Topics/spaced-repetition-learning/Sources/items/source.md',
        sourceSha256,
        type: 'source-read',
      },
      now,
    );
    const file = await recordResearchThreadEvent(
      storage,
      'spaced-repetition-learning',
      { format: 'markdown', manifestSha256, type: 'export-created' },
      now,
    );

    expect(file?.events?.map((event) => event.type)).toEqual([
      'question-created',
      'research-completed',
      'source-saved',
      'quote-added',
      'source-read',
      'export-created',
    ]);
  });

  it('follows explicitly and links a source note to the source event it answers', async () => {
    const storage = await topicStorage();
    const research = await recordResearchRun(storage, 'spaced-repetition-learning', run(), now);
    const threadId = research.activeThreadId!;
    const followedAt = new Date('2026-08-02T10:30:00.000Z');
    await setResearchThreadFollowed(
      storage,
      'spaced-repetition-learning',
      threadId,
      true,
      followedAt,
    );
    const sourceAt = new Date('2026-08-02T11:00:00.000Z');
    await recordResearchThreadEvent(
      storage,
      'spaced-repetition-learning',
      {
        readState: 'read',
        sourcePath: 'Topics/spaced-repetition-learning/Sources/items/source.md',
        sourceSha256: 'a'.repeat(64),
        type: 'source-saved',
      },
      sourceAt,
      threadId,
    );
    const noteAt = new Date('2026-08-02T11:15:00.000Z');
    const file = await recordResearchThreadEvent(
      storage,
      'spaced-repetition-learning',
      {
        notePath: 'Topics/spaced-repetition-learning/Notes/source-note.md',
        noteSha256: 'b'.repeat(64),
        sourcePath: 'Topics/spaced-repetition-learning/Sources/items/source.md',
        sourceSha256: 'a'.repeat(64),
        type: 'note-added',
      },
      noteAt,
      threadId,
    );

    expect(file?.threads?.[0]?.followedAt).toBe(followedAt.toISOString());
    const sourceEvent = file?.events?.find((event) => event.type === 'source-saved');
    expect(file?.events?.find((event) => event.type === 'note-added')).toMatchObject({
      replyToEventId: sourceEvent?.eventId,
      sourceSha256: 'a'.repeat(64),
    });

    const differentSource = await recordResearchThreadEvent(
      storage,
      'spaced-repetition-learning',
      {
        notePath: 'Topics/spaced-repetition-learning/Notes/other-source-note.md',
        noteSha256: 'c'.repeat(64),
        sourcePath: 'Topics/spaced-repetition-learning/Sources/items/other-source.md',
        sourceSha256: 'a'.repeat(64),
        type: 'note-added',
      },
      new Date('2026-08-02T11:20:00.000Z'),
      threadId,
    );
    expect(
      differentSource?.events?.find(
        (event) => event.type === 'note-added' && event.noteSha256 === 'c'.repeat(64),
      ),
    ).not.toHaveProperty('replyToEventId');

    const unfollowed = await setResearchThreadFollowed(
      storage,
      'spaced-repetition-learning',
      threadId,
      false,
      new Date('2026-08-02T11:30:00.000Z'),
    );
    expect(unfollowed.threads?.[0]?.followedAt).toBeUndefined();
  });

  it('redacts the stored question and query without deleting artifacts or thread identity', async () => {
    const storage = await topicStorage();
    const research = await recordResearchRun(storage, 'spaced-repetition-learning', run(), now);
    const threadId = research.activeThreadId!;
    await storage.write(
      'Topics/spaced-repetition-learning/Synthesis.md',
      '# Answer\n\nThe saved answer remains independently authored.\n',
      { expectedHash: null },
    );

    const redacted = await redactResearchThread(
      storage,
      'spaced-repetition-learning',
      threadId,
      new Date('2026-08-02T11:00:00.000Z'),
    );

    expect(redacted.threads?.[0]).toMatchObject({
      questionText: 'Redacted question',
      threadId,
    });
    expect(redacted.runs?.[0]).toMatchObject({
      questionText: 'Redacted question',
      searchText: 'Redacted research query',
    });
    expect(JSON.stringify(redacted)).not.toContain('How does spaced repetition support learning?');
    expect(redacted.events?.at(-1)?.type).toBe('thread-redacted');
    expect(await storage.read('Topics/spaced-repetition-learning/Synthesis.md')).not.toBeNull();
  });

  it('deletes owned runs and events while retaining a minimal parent tombstone for a child', async () => {
    const storage = await topicStorage();
    const first = await recordResearchRun(storage, 'spaced-repetition-learning', run(), now);
    const parentThreadId = first.activeThreadId!;
    const child = await recordResearchRun(
      storage,
      'spaced-repetition-learning',
      run({
        candidates: [],
        parentThreadId,
        providers: [],
        questionText: 'What is the strongest interval evidence?',
        searchText: 'Strongest interval evidence',
      }),
      new Date('2026-08-02T11:00:00.000Z'),
    );
    const childThreadId = child.activeThreadId!;

    const deleted = await deleteResearchThread(
      storage,
      'spaced-repetition-learning',
      parentThreadId,
      new Date('2026-08-02T12:00:00.000Z'),
    );

    expect(deleted.threads?.map((thread) => thread.threadId)).toEqual([childThreadId]);
    expect(deleted.runs?.some((item) => item.threadId === parentThreadId)).toBe(false);
    expect(deleted.events?.some((event) => event.threadId === parentThreadId)).toBe(false);
    expect(deleted.threadTombstones).toContainEqual(
      expect.objectContaining({ reason: 'deleted', threadId: parentThreadId }),
    );
    expect(JSON.stringify(deleted.threadTombstones)).not.toContain(
      'How does spaced repetition support learning?',
    );
  });

  it('round-trips followed state, note replies, redaction, and tombstones through a workspace ZIP', async () => {
    const storage = await topicStorage();
    const first = await recordResearchRun(storage, 'spaced-repetition-learning', run(), now);
    const parentThreadId = first.activeThreadId!;
    await setResearchThreadFollowed(
      storage,
      'spaced-repetition-learning',
      parentThreadId,
      true,
      new Date('2026-08-02T10:05:00.000Z'),
    );
    await recordResearchRun(
      storage,
      'spaced-repetition-learning',
      run({
        candidates: [],
        parentThreadId,
        providers: [],
        questionText: 'Which evidence changed?',
        searchText: 'Which evidence changed?',
      }),
      new Date('2026-08-02T11:00:00.000Z'),
    );
    await deleteResearchThread(
      storage,
      'spaced-repetition-learning',
      parentThreadId,
      new Date('2026-08-02T12:00:00.000Z'),
    );
    const restored = new MemoryStorageAdapter();
    await importWorkspace(restored, await exportWorkspace(storage));

    const file = await readResearchFile(restored, 'spaced-repetition-learning', now);
    expect(file?.threadTombstones).toContainEqual(
      expect.objectContaining({ reason: 'deleted', threadId: parentThreadId }),
    );
    expect(file?.threads?.[0]?.parentThreadId).toBe(parentThreadId);
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
    let firstThreadId = '';

    for (let index = 0; index < 51; index += 1) {
      const recorded = await recordResearchRun(
        storage,
        'spaced-repetition-learning',
        run({
          candidates: [],
          providers: [],
          questionText: `question ${index}`,
          searchText: `query ${index}`,
        }),
        new Date(now.getTime() + index * 60_000),
      );
      if (index === 0) firstThreadId = recorded.activeThreadId!;
    }

    const file = await readResearchFile(storage, 'spaced-repetition-learning', now);
    expect(file?.runs).toHaveLength(50);
    expect(file?.runs?.[0]?.searchText).toBe('query 1');
    expect(file?.runs?.at(-1)?.searchText).toBe('query 50');
    expect(file?.threads).toHaveLength(50);
    expect(file?.threads?.[0]?.questionText).toBe('question 1');
    expect(file?.events?.some((event) => event.threadId === file?.runs?.[0]?.threadId)).toBe(true);
    expect(file?.events?.some((event) => event.threadId === firstThreadId)).toBe(false);
    expect(file?.threadTombstones).toContainEqual(
      expect.objectContaining({ reason: 'retention', threadId: firstThreadId }),
    );
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
