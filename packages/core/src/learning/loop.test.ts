import { describe, expect, it } from 'vitest';

import { acceptMarkdownUpdate } from '../conflict/write-protocol.js';
import { TopicStateSchema } from '../schemas/workspace.js';
import { readMachineFile } from '../schemas/read-machine-file.js';
import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace } from '../workspace/create.js';
import {
  buildTodaySummary,
  buildReviewQueue,
  buildWorkspaceRecap,
  nextScheduledReview,
  parseRoadmapObjectives,
  progressFromRoadmap,
  setRoadmapObjectiveCompleted,
  setTopicStatus,
  updateRoadmapObjective,
} from './loop.js';
import { markTopicReviewed } from './review.js';

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

  it('orders active topics by oldest local update, then paused topics, and excludes complete work', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    await createTopic(storage, 'Older active', new Date('2026-07-17T12:00:00.000Z'));
    await createTopic(storage, 'Newer active', new Date('2026-07-19T12:00:00.000Z'));
    const paused = await createTopic(storage, 'Paused topic', new Date('2026-07-16T12:00:00.000Z'));
    const complete = await createTopic(
      storage,
      'Complete topic',
      new Date('2026-07-15T12:00:00.000Z'),
    );
    const workspace = complete.workspace;
    await setTopicStatus(storage, paused.topicSlug, 'paused', new Date('2026-07-20T12:00:00.000Z'));
    await setTopicStatus(
      storage,
      complete.topicSlug,
      'complete',
      new Date('2026-07-20T12:01:00.000Z'),
    );

    const summaries = await buildTodaySummary(storage, workspace);
    const queue = buildReviewQueue(summaries);

    expect(queue.map((item) => item.title)).toEqual([
      'Older active',
      'Newer active',
      'Paused topic',
    ]);
    expect(queue[0]).toMatchObject({
      objective: 'Establish the terms and boundaries.',
      reason: 'Active · least recently updated first',
    });
    expect(queue[2]?.reason).toBe('Paused · resume when ready');
  });

  it('builds a bounded recent-first recap from dated local update entries', async () => {
    const storage = new MemoryStorageAdapter();
    const workspace = await createWorkspace(storage, 'Dusori', now);
    const topic = await createTopic(storage, 'AI Fundamentals', now);
    const currentWorkspace = { ...workspace, topics: topic.workspace.topics };
    await updateRoadmapObjective(
      storage,
      topic.topicSlug,
      0,
      true,
      new Date('2026-07-21T09:00:00.000Z'),
    );
    await setTopicStatus(storage, topic.topicSlug, 'paused', new Date('2026-07-21T10:00:00.000Z'));

    const recap = await buildWorkspaceRecap(storage, currentWorkspace, {
      days: 1,
      now: new Date('2026-07-21T18:00:00.000Z'),
    });

    expect(recap).toMatchObject({ from: '2026-07-21', to: '2026-07-21', topicsTouched: 1 });
    expect(recap.entries.map((entry) => entry.text)).toEqual([
      'Paused this topic.',
      'Completed “Establish the terms and boundaries.” in roadmap.',
    ]);
  });
});

describe('spaced review queue', () => {
  it('promotes due reviews, keeps unscheduled order, and hides future-due topics', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    const overdue = await createTopic(
      storage,
      'Overdue topic',
      new Date('2026-07-10T12:00:00.000Z'),
    );
    const dueToday = await createTopic(
      storage,
      'Due today topic',
      new Date('2026-07-11T12:00:00.000Z'),
    );
    await createTopic(storage, 'Never reviewed', new Date('2026-07-12T12:00:00.000Z'));
    const scheduled = await createTopic(
      storage,
      'Scheduled out',
      new Date('2026-07-13T12:00:00.000Z'),
    );
    const workspace = scheduled.workspace;
    await markTopicReviewed(
      storage,
      overdue.topicSlug,
      'good',
      new Date('2026-07-15T12:00:00.000Z'),
    );
    await markTopicReviewed(
      storage,
      dueToday.topicSlug,
      'good',
      new Date('2026-07-19T12:00:00.000Z'),
    );
    await markTopicReviewed(
      storage,
      scheduled.topicSlug,
      'good',
      new Date('2026-07-18T12:00:00.000Z'),
    );
    await markTopicReviewed(
      storage,
      scheduled.topicSlug,
      'good',
      new Date('2026-07-19T12:00:00.000Z'),
    );

    const summaries = await buildTodaySummary(storage, workspace);
    const asOf = new Date('2026-07-20T12:00:00.000Z');
    const queue = buildReviewQueue(summaries, 5, asOf);

    expect(queue.map((item) => item.title)).toEqual([
      'Overdue topic',
      'Due today topic',
      'Never reviewed',
    ]);
    expect(queue[0]).toMatchObject({
      dueOn: '2026-07-16',
      reason: 'Overdue since 2026-07-16 · spaced review',
    });
    expect(queue[1]).toMatchObject({ dueOn: '2026-07-20', reason: 'Due today · spaced review' });
    expect(queue[2]).toMatchObject({
      dueOn: null,
      reason: 'Active · least recently updated first',
    });
    expect(nextScheduledReview(summaries, asOf)).toEqual({
      dueOn: '2026-07-22',
      slug: scheduled.topicSlug,
      title: 'Scheduled out',
    });
  });

  it('keeps paused topics in their place regardless of schedule', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    await createTopic(storage, 'Active fresh', new Date('2026-07-18T12:00:00.000Z'));
    const paused = await createTopic(
      storage,
      'Paused scheduled',
      new Date('2026-07-17T12:00:00.000Z'),
    );
    await markTopicReviewed(
      storage,
      paused.topicSlug,
      'good',
      new Date('2026-07-18T12:00:00.000Z'),
    );
    await markTopicReviewed(
      storage,
      paused.topicSlug,
      'good',
      new Date('2026-07-19T12:00:00.000Z'),
    );
    await setTopicStatus(storage, paused.topicSlug, 'paused', new Date('2026-07-19T13:00:00.000Z'));

    const summaries = await buildTodaySummary(storage, paused.workspace);
    const asOf = new Date('2026-07-20T12:00:00.000Z');
    const queue = buildReviewQueue(summaries, 5, asOf);

    expect(queue.map((item) => item.title)).toEqual(['Active fresh', 'Paused scheduled']);
    expect(queue[1]).toMatchObject({ dueOn: '2026-07-22', reason: 'Paused · resume when ready' });
    expect(nextScheduledReview(summaries, asOf)).toBeNull();
  });
});
