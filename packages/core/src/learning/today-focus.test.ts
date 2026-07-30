import { describe, expect, it } from 'vitest';

import { proposeMarkdownUpdate } from '../conflict/write-protocol.js';
import { addSource } from '../sources/import.js';
import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace } from '../workspace/create.js';
import { buildTodaySummary, setTopicStatus } from './loop.js';
import { markTopicReviewed } from './review.js';
import { buildTodayFocus } from './today-focus.js';

const now = new Date('2026-07-30T12:00:00.000Z');

async function oneTopic() {
  const storage = new MemoryStorageAdapter();
  const empty = await createWorkspace(storage, 'Dusori', now);
  const topic = await createTopic(storage, 'Evidence loops', now);
  const workspace = { ...empty, topics: topic.workspace.topics };
  return { storage, topic, workspace };
}

describe('Today focus', () => {
  it('routes an objective without readable sources to Research', async () => {
    const { storage, workspace } = await oneTopic();
    const summaries = await buildTodaySummary(storage, workspace);

    const focus = await buildTodayFocus(storage, workspace, summaries, now);

    expect(focus.continueLearning[0]).toMatchObject({
      action: 'research-objective',
      sourceReady: false,
      title: 'Evidence loops',
    });
    expect(focus.needsAttention).toEqual([]);
  });

  it('routes a source-ready objective to its roadmap and a due review to recall', async () => {
    const { storage, topic, workspace } = await oneTopic();
    await addSource(
      storage,
      {
        content:
          '# Reliable evidence\n\nThis approved local source contains enough readable prose to support deterministic recall.',
        mediaType: 'text/markdown',
        method: 'paste',
        title: 'Reliable evidence',
        topicSlug: topic.topicSlug,
      },
      now,
    );

    let summaries = await buildTodaySummary(storage, workspace);
    expect(
      (await buildTodayFocus(storage, workspace, summaries, now)).continueLearning[0],
    ).toMatchObject({
      action: 'open-roadmap',
      canStartReview: true,
      sourceReady: true,
    });

    await markTopicReviewed(storage, topic.topicSlug, 'good', new Date('2026-07-29T12:00:00.000Z'));
    summaries = await buildTodaySummary(storage, workspace);
    expect(
      (await buildTodayFocus(storage, workspace, summaries, now)).continueLearning[0],
    ).toMatchObject({
      action: 'start-review',
      canStartReview: true,
      dueOn: '2026-07-30',
    });
  });

  it('opens a paused topic without changing its state', async () => {
    const { storage, topic, workspace } = await oneTopic();
    await setTopicStatus(storage, topic.topicSlug, 'paused', now);
    const summaries = await buildTodaySummary(storage, workspace);

    expect(
      (await buildTodayFocus(storage, workspace, summaries, now)).continueLearning[0],
    ).toMatchObject({
      action: 'open-topic',
      status: 'paused',
    });
  });

  it('surfaces durable proposals before aggregated link hygiene', async () => {
    const { storage, topic, workspace } = await oneTopic();
    const notePath = `Topics/${topic.topicSlug}/Notes/001-first-look.md`;
    await storage.externalWrite(
      notePath,
      `${(await storage.read(notePath))!.content}\n\nExternal note.\n`,
    );
    const proposal = await proposeMarkdownUpdate(
      storage,
      topic.topicSlug,
      'Notes/001-first-look.md',
      '# Proposed note\n',
      now,
    );
    if (!('proposalPath' in proposal)) throw new Error('Expected a proposal.');
    await storage.write(
      `Topics/${topic.topicSlug}/Notes/unresolved.md`,
      '# Link\n\n[[Missing page]]\n',
    );
    const summaries = await buildTodaySummary(storage, workspace);

    const focus = await buildTodayFocus(storage, workspace, summaries, now);

    expect(focus.needsAttention[0]).toMatchObject({
      action: 'review-proposal',
      currentPath: notePath,
      priority: 'integrity',
      proposalPath: proposal.proposalPath,
    });
    expect(focus.needsAttention.at(-1)).toMatchObject({
      action: 'open-workspace-health',
      count: 1,
      priority: 'hygiene',
    });
  });
});
