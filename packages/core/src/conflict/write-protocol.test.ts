import { describe, expect, it, vi } from 'vitest';

import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { TopicStateSchema } from '../schemas/workspace.js';
import { createTopic, createWorkspace } from '../workspace/create.js';
import { acceptMarkdownUpdate, proposeMarkdownUpdate } from './write-protocol.js';

const now = new Date('2026-09-11T00:00:00.000Z');

describe('document state commits', () => {
  it.each(['before-tracking', 'state-conflict'])(
    'does not roll back a later same-document save when the older save resumes at %s',
    async (during) => {
      const storage = new MemoryStorageAdapter();
      await createWorkspace(storage, 'Test', now);
      const topic = await createTopic(storage, 'Study', now);
      const statePath = `Topics/${topic.topicSlug}/state.json`;
      const note = (await storage.read(topic.notePath))!;
      const write = storage.write.bind(storage);
      let inject = true;
      const saveLater = async () => {
        inject = false;
        const current = (await storage.read(note.path))!;
        expect(current.content).toBe('# Save A');
        await acceptMarkdownUpdate(
          storage,
          topic.topicSlug,
          'Notes/001-first-look.md',
          '# Save B',
          current.hash,
          new Date(now.getTime() + 1),
          '- Save B receipt.',
        );
      };
      vi.spyOn(storage, 'write').mockImplementation(async (path, content, options) => {
        if (inject && during === 'state-conflict' && path === statePath) {
          await saveLater();
        }
        const written = await write(path, content, options);
        if (inject && during === 'before-tracking' && path === note.path) {
          await saveLater();
        }
        return written;
      });

      const returned = await acceptMarkdownUpdate(
        storage,
        topic.topicSlug,
        'Notes/001-first-look.md',
        '# Save A',
        note.hash,
        now,
        '- Save A receipt.',
      );
      const current = (await storage.read(note.path))!;
      const state = TopicStateSchema.parse(JSON.parse((await storage.read(statePath))!.content));
      expect(current.content).toBe('# Save B');
      expect(state.fileIndex[note.path]!.hash).toBe(current.hash);
      expect(returned.fileIndex[note.path]!.hash).toBe(current.hash);
      const updates = await storage.list(`Topics/${topic.topicSlug}/Updates`, true);
      const logs = (
        await Promise.all(
          updates
            .filter((entry) => entry.kind === 'file')
            .map(async (entry) => (await storage.read(entry.path))!.content),
        )
      ).join('\n');
      expect(logs.match(/Save A receipt/gu)).toHaveLength(1);
      expect(logs.match(/Save B receipt/gu)).toHaveLength(1);
    },
  );

  it('does not claim an intervening external edit as a tracked Dusori write', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Test', now);
    const topic = await createTopic(storage, 'Study', now);
    const note = (await storage.read(topic.notePath))!;
    const write = storage.write.bind(storage);
    let inject = true;
    vi.spyOn(storage, 'write').mockImplementation(async (path, content, options) => {
      const written = await write(path, content, options);
      if (inject && path === note.path) {
        inject = false;
        await storage.externalWrite(note.path, '# Learner external edit');
      }
      return written;
    });
    await acceptMarkdownUpdate(
      storage,
      topic.topicSlug,
      'Notes/001-first-look.md',
      '# Save A',
      note.hash,
      now,
    );
    const next = await proposeMarkdownUpdate(
      storage,
      topic.topicSlug,
      'Notes/001-first-look.md',
      '# Future generated edit',
      now,
    );
    expect('proposalPath' in next).toBe(true);
    expect((await storage.read(note.path))!.content).toBe('# Learner external edit');
  });

  it.each(['document', 'state'])(
    'preserves a concurrent state change at the %s write',
    async (during) => {
      const storage = new MemoryStorageAdapter();
      await createWorkspace(storage, 'Test', now);
      const topic = await createTopic(storage, 'Study', now);
      const statePath = `Topics/${topic.topicSlug}/state.json`;
      const note = (await storage.read(topic.notePath))!;
      const write = storage.write.bind(storage);
      let inject = true;
      vi.spyOn(storage, 'write').mockImplementation(async (path, content, options) => {
        if (inject && path === (during === 'document' ? note.path : statePath)) {
          inject = false;
          const snapshot = (await storage.read(statePath))!;
          const state = TopicStateSchema.parse(JSON.parse(snapshot.content));
          await write(
            statePath,
            JSON.stringify({
              ...state,
              status: 'paused',
              learnerExtension: 'preserve me',
            }),
            { expectedHash: snapshot.hash },
          );
        }
        return write(path, content, options);
      });

      await acceptMarkdownUpdate(
        storage,
        topic.topicSlug,
        'Notes/001-first-look.md',
        '# Saved once',
        note.hash,
        now,
        '- Unique save receipt.',
      );
      const state = TopicStateSchema.parse(JSON.parse((await storage.read(statePath))!.content));
      expect(state.status).toBe('paused');
      expect(state.learnerExtension).toBe('preserve me');
      expect(state.fileIndex[note.path]!.hash).toBe((await storage.read(note.path))!.hash);
      const updates = await storage.list(`Topics/${topic.topicSlug}/Updates`, true);
      const content = (
        await Promise.all(
          updates
            .filter((entry) => entry.kind === 'file')
            .map(async (entry) => (await storage.read(entry.path))!.content),
        )
      ).join('\n');
      expect(content.match(/Unique save receipt/gu)).toHaveLength(1);
    },
  );

  it('preserves the version of a different document saved during the first save', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Test', now);
    const topic = await createTopic(storage, 'Study', now);
    const note = (await storage.read(topic.notePath))!;
    const roadmap = (await storage.read(`Topics/${topic.topicSlug}/roadmap.md`))!;
    const write = storage.write.bind(storage);
    let inject = true;
    vi.spyOn(storage, 'write').mockImplementation(async (path, content, options) => {
      if (inject && path === note.path) {
        inject = false;
        await acceptMarkdownUpdate(
          storage,
          topic.topicSlug,
          'roadmap.md',
          '# Concurrent roadmap',
          roadmap.hash,
          now,
        );
      }
      return write(path, content, options);
    });
    await acceptMarkdownUpdate(
      storage,
      topic.topicSlug,
      'Notes/001-first-look.md',
      '# Concurrent note',
      note.hash,
      now,
    );
    const state = TopicStateSchema.parse(
      JSON.parse((await storage.read(`Topics/${topic.topicSlug}/state.json`))!.content),
    );
    for (const path of [note.path, roadmap.path]) {
      expect(state.fileIndex[path]!.hash).toBe((await storage.read(path))!.hash);
    }
  });
});
