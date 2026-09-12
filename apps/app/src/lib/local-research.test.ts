import { afterEach, describe, expect, it, vi } from 'vitest';

import { addSource, createTopic, createWorkspace, readResearchFile } from '@dusori/core';
import { MemoryStorageAdapter } from '../../../../packages/core/src/testing/memory-storage.js';

import {
  buildLocalResearch,
  pendingResearchReceipt,
  retainResearchReceipt,
  retryResearchReceipt,
  type PendingResearchReceipt,
} from './local-research';

const now = new Date('2026-09-11T12:00:00.000Z');

async function topicFixture() {
  const storage = new MemoryStorageAdapter();
  await createWorkspace(storage, 'Fixture', now);
  const topic = await createTopic(storage, 'Local reading', now);
  return { storage, topic };
}

afterEach(() => vi.unstubAllGlobals());

describe('local research continuation', () => {
  it('builds a detached brief from pasted text without any network call or prior run', async () => {
    const { storage, topic } = await topicFixture();
    await addSource(
      storage,
      {
        content:
          '# Evidence\n\nRetrieval practice improves later recall when learners actively reconstruct an answer from memory before checking it.\n',
        method: 'paste',
        title: 'Local learning notes',
        topicSlug: topic.topicSlug,
      },
      now,
    );
    const fetchSpy = vi.fn(() => {
      throw new Error('network must remain unreachable');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await buildLocalResearch(storage, topic.topicSlug, 'Local reading', { now });

    expect(result.path).toBe(`Topics/${topic.topicSlug}/Synthesis.md`);
    expect(result.message).toContain('No original pages were fetched.');
    expect(fetchSpy).not.toHaveBeenCalled();
    const research = await readResearchFile(storage, topic.topicSlug, now);
    expect(research?.synthesisDetachedAt).toBe(now.toISOString());
    expect(research?.synthesisRunAt).toBeUndefined();
  });

  it('blocks local building until the exact failed receipt is saved without searching again', async () => {
    const { storage, topic } = await topicFixture();
    const receipt: PendingResearchReceipt = {
      at: now.toISOString(),
      message: 'Research history could not be saved.',
      receipt: {
        candidates: [],
        providers: [{ count: 0, id: 'fixture', label: 'Fixture', outcome: 'empty' }],
        questionText: 'What did the local notes show?',
        searchText: 'local notes evidence',
      },
    };
    retainResearchReceipt(storage, topic.topicSlug, receipt);
    await expect(
      buildLocalResearch(storage, topic.topicSlug, 'Local reading', { now }),
    ).rejects.toThrow('Save the pending research receipt');

    const run = await retryResearchReceipt(storage, topic.topicSlug);

    expect(run?.questionText).toBe(receipt.receipt.questionText);
    expect(pendingResearchReceipt(storage, topic.topicSlug)).toBeUndefined();
    expect((await readResearchFile(storage, topic.topicSlug, now))?.runs).toHaveLength(1);
  });
});
