import { describe, expect, it } from 'vitest';

import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace } from '../workspace/create.js';
import {
  recordResearchRun,
  recordResearchThreadEvent,
  setResearchThreadFollowed,
  type ResearchRunInput,
} from './research-file.js';
import { readFollowedResearchUpdates } from './updates.js';

const now = new Date('2026-08-28T10:00:00.000Z');

function run(questionText: string): ResearchRunInput {
  return {
    candidates: [],
    providers: [],
    questionText,
    searchText: questionText,
  };
}

describe('followed research updates', () => {
  it('derives only post-follow local activity and reports missing artifacts without writing', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    await createTopic(storage, 'Alpha research', now);
    const { workspace } = await createTopic(storage, 'Beta research', now);
    const alpha = await recordResearchRun(storage, 'alpha-research', run('What changed?'), now);
    await recordResearchRun(storage, 'beta-research', run('What stayed stable?'), now);
    const threadId = alpha.activeThreadId!;
    await setResearchThreadFollowed(
      storage,
      'alpha-research',
      threadId,
      true,
      new Date('2026-08-28T10:30:00.000Z'),
    );
    await recordResearchThreadEvent(
      storage,
      'alpha-research',
      {
        readState: 'read',
        sourcePath: 'Topics/alpha-research/Sources/items/source.md',
        sourceSha256: 'a'.repeat(64),
        type: 'source-saved',
      },
      new Date('2026-08-28T11:00:00.000Z'),
      threadId,
    );
    await recordResearchThreadEvent(
      storage,
      'alpha-research',
      {
        notePath: 'Topics/alpha-research/Notes/source-note.md',
        noteSha256: 'b'.repeat(64),
        sourcePath: 'Topics/alpha-research/Sources/items/source.md',
        sourceSha256: 'a'.repeat(64),
        type: 'note-added',
      },
      new Date('2026-08-28T11:15:00.000Z'),
      threadId,
    );
    const researchBefore = await storage.read('Topics/alpha-research/research.json');

    const inbox = await readFollowedResearchUpdates(storage, workspace.topics, now);

    expect(inbox.unavailableTopics).toEqual([]);
    expect(inbox.items).toHaveLength(1);
    expect(inbox.items[0]).toMatchObject({
      questionText: 'What changed?',
      threadId,
      topicSlug: 'alpha-research',
      topicTitle: 'Alpha research',
    });
    expect(inbox.items[0]?.events.map((item) => item.event.type)).toEqual([
      'note-added',
      'source-saved',
    ]);
    expect(inbox.items[0]?.events[0]).toMatchObject({
      artifactState: 'missing',
      replyState: 'available',
    });
    expect((await storage.read('Topics/alpha-research/research.json'))?.hash).toBe(
      researchBefore?.hash,
    );
  });
});
