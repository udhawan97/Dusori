import { describe, expect, it, vi } from 'vitest';

import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace } from '../workspace/create.js';
import { detachResearchSynthesis, readResearchFile, recordResearchRun } from './research-file.js';

describe('local synthesis provenance detachment', () => {
  it('retries a concurrent ledger edit without changing historical runs or activity', async () => {
    const storage = new MemoryStorageAdapter();
    const now = new Date('2026-09-11T12:00:00Z');
    await createWorkspace(storage, 'Fixture', now);
    const topic = await createTopic(storage, 'Local reading', now);
    const original = await recordResearchRun(
      storage,
      topic.topicSlug,
      {
        questionText: 'Older question?',
        searchText: 'Older question?',
        candidates: [],
        providers: [],
      },
      now,
    );
    const path = `Topics/${topic.topicSlug}/research.json`;
    const write = storage.write.bind(storage);
    let interleaved = false;
    const spy = vi.spyOn(storage, 'write').mockImplementation(async (target, content, options) => {
      if (target === path && !interleaved) {
        interleaved = true;
        const current = await storage.read(path);
        await write(path, JSON.stringify({ ...JSON.parse(current!.content), autoRefresh: true }), {
          expectedHash: current!.hash,
        });
      }
      return write(target, content, options);
    });
    await detachResearchSynthesis(storage, topic.topicSlug, now);
    spy.mockRestore();
    const after = await readResearchFile(storage, topic.topicSlug);
    expect(interleaved).toBe(true);
    expect(after?.autoRefresh).toBe(true);
    expect(after?.synthesisRunAt).toBeUndefined();
    expect(after?.synthesisDetachedAt).toBe(now.toISOString());
    expect(after?.runs).toEqual(original.runs);
    expect(after?.events).toEqual(original.events);
  });
});
