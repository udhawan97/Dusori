import { describe, expect, it } from 'vitest';

import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace } from '../workspace/create.js';
import { setTopicStatus, updateRoadmapObjective } from './loop.js';
import { projectToday } from './today.js';

const now = new Date('2026-08-11T12:00:00.000Z');

describe('projectToday', () => {
  it('returns one complete read-only projection and excludes completed missions', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    const active = await createTopic(storage, 'TypeScript', now);
    const complete = await createTopic(storage, 'Rust', now);
    await updateRoadmapObjective(storage, active.topicSlug, 0, true, now);
    await setTopicStatus(storage, complete.topicSlug, 'complete', now);
    const before = [...storage.files.entries()].map(([path, file]) => [path, { ...file }]);

    const today = await projectToday(storage, complete.workspace, now);

    expect(today.summaries).toHaveLength(2);
    expect(today.missions.map((mission) => mission.topicSlug)).toEqual([active.topicSlug]);
    expect(today.totals).toMatchObject({
      activeTopics: 1,
      completedObjectives: 1,
      topics: 2,
    });
    expect(today.focus).toEqual(expect.objectContaining({ continueLearning: expect.any(Array) }));
    expect(today.recap).toEqual(expect.objectContaining({ entries: expect.any(Array) }));
    expect(today.nextReview).toBeNull();
    expect([...storage.files.entries()].map(([path, file]) => [path, { ...file }])).toEqual(before);
  });
});
