import { describe, expect, it } from 'vitest';

import { acceptMarkdownUpdate } from '../conflict/write-protocol.js';
import { TopicStateSchema } from '../schemas/workspace.js';
import { readMachineFile } from '../schemas/read-machine-file.js';
import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace } from '../workspace/create.js';
import {
  buildTodaySummary,
  parseRoadmapObjectives,
  progressFromRoadmap,
  setRoadmapObjectiveCompleted,
  setTopicStatus,
  updateRoadmapObjective,
} from './loop.js';

const now = new Date('2026-07-20T12:00:00.000Z');

describe('roadmap progress', () => {
  it('parses nested Markdown tasks and preserves non-task content when one changes', () => {
    const roadmap = `# Roadmap\n\n- [ ] First objective\n  - [x] [[Notes/example|Applied example]]\n\nKeep this paragraph.\n`;
    expect(parseRoadmapObjectives(roadmap)).toEqual([
      { completed: false, depth: 0, index: 0, title: 'First objective' },
      { completed: true, depth: 1, index: 1, title: 'Applied example' },
    ]);
    expect(setRoadmapObjectiveCompleted(roadmap, 0, true)).toBe(
      roadmap.replace('- [ ] First objective', '- [x] First objective'),
    );
    expect(progressFromRoadmap(roadmap)).toMatchObject({ completed: 1, percent: 50, total: 2 });
    expect(progressFromRoadmap('## Foundation\n\n- [ ] Terms\n').entries).toEqual([
      { depth: 0, kind: 'section', title: 'Foundation' },
      { completed: false, depth: 1, index: 0, kind: 'objective', title: 'Terms' },
    ]);
  });

  it('updates one objective through the tracked Markdown write protocol', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    const topic = await createTopic(storage, 'AI Fundamentals', now);

    const result = await updateRoadmapObjective(
      storage,
      topic.topicSlug,
      0,
      true,
      new Date('2026-07-20T12:05:00.000Z'),
    );

    expect(result.status).toBe('updated');
    expect((await storage.read(`Topics/${topic.topicSlug}/roadmap.md`))?.content).toContain(
      '- [x] Establish the terms and boundaries.',
    );
    const update = await storage.read(topic.updatePath);
    expect(update?.content).toContain('Completed “Establish the terms and boundaries.”');
    const state = await readMachineFile(
      storage,
      `Topics/${topic.topicSlug}/state.json`,
      TopicStateSchema,
    );
    expect(state.fileIndex[`Topics/${topic.topicSlug}/roadmap.md`]?.hash).toBe(
      (await storage.read(`Topics/${topic.topicSlug}/roadmap.md`))?.hash,
    );
  });

  it('leaves an external roadmap edit untouched until the proposal is accepted', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    const topic = await createTopic(storage, 'AI Fundamentals', now);
    const path = `Topics/${topic.topicSlug}/roadmap.md`;
    const original = (await storage.read(path))!.content;
    const external = `${original.trimEnd()}\n\nExternal planning note.\n`;
    await storage.externalWrite(path, external);

    const result = await updateRoadmapObjective(
      storage,
      topic.topicSlug,
      0,
      true,
      new Date('2026-07-20T12:10:00.000Z'),
    );

    expect(result.status).toBe('conflict');
    expect((await storage.read(path))?.content).toBe(external);
    if (result.status === 'conflict') {
      expect((await storage.read(result.conflict.proposalPath))?.content).toContain(
        '- [x] Establish the terms and boundaries.',
      );
      await acceptMarkdownUpdate(
        storage,
        topic.topicSlug,
        'roadmap.md',
        result.conflict.proposalContent,
        result.conflict.currentContentHash,
      );
    }
    expect((await storage.read(path))?.content).toContain(
      '- [x] Establish the terms and boundaries.',
    );
  });
});

describe('today summary', () => {
  it('derives topic state, next objective, progress, and recent local activity', async () => {
    const storage = new MemoryStorageAdapter();
    const workspace = await createWorkspace(storage, 'Dusori', now);
    const topic = await createTopic(storage, 'AI Fundamentals', now);
    await updateRoadmapObjective(
      storage,
      topic.topicSlug,
      0,
      true,
      new Date('2026-07-20T12:05:00.000Z'),
    );
    await setTopicStatus(storage, topic.topicSlug, 'paused', new Date('2026-07-20T12:06:00.000Z'));

    const currentWorkspace = { ...workspace, topics: topic.workspace.topics };
    const [summary] = await buildTodaySummary(storage, currentWorkspace);

    expect(summary).toMatchObject({
      slug: topic.topicSlug,
      status: 'paused',
      title: 'AI Fundamentals',
      progress: {
        completed: 1,
        nextObjective: { title: 'Explain the central mechanism in your own words.' },
        percent: 33,
        total: 3,
      },
    });
    expect(summary?.recentActivity[0]?.text).toBe('Paused this topic.');
    expect(summary?.recentActivity[1]?.text).toContain('Completed “Establish the terms');
  });
});
