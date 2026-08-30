import { describe, expect, it } from 'vitest';

import { addDaysUtc, localDateOf } from '../learning/review.js';
import { buildWorkspaceRecap } from '../learning/loop.js';
import { createNote } from '../notes/edit.js';
import { schemaVersion } from '../schemas/workspace.js';
import type { StorageAdapter } from '../adapters.js';
import { addSource } from '../sources/import.js';
import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace } from '../workspace/create.js';
import { updateLogPath } from '../workspace/paths.js';
import { buildWorkspaceInsights } from './workspace-insights.js';

const now = new Date('2026-07-27T12:00:00.000Z');

async function writeSchedule(
  storage: StorageAdapter,
  topicSlug: string,
  dueOn: string,
): Promise<void> {
  await storage.write(
    `Topics/${topicSlug}/review.json`,
    `${JSON.stringify(
      { schemaVersion, topicSlug, repetition: 0, lastReviewedOn: dueOn, dueOn },
      null,
      2,
    )}\n`,
  );
}

describe('workspace insights', () => {
  it('uses one UTC calendar key for update paths, recap bounds, and activity labels', async () => {
    const storage = new MemoryStorageAdapter();
    const boundary = new Date('2026-08-04T00:30:00.000Z');
    await createWorkspace(storage, 'Dusori', boundary);
    const created = await createTopic(storage, 'UTC boundary', boundary);
    await createNote(storage, created.topicSlug, 'Boundary note', boundary);

    expect(await storage.read(updateLogPath(created.topicSlug, boundary))).not.toBeNull();

    const recap = await buildWorkspaceRecap(storage, created.workspace, {
      days: 1,
      now: boundary,
    });
    const insights = await buildWorkspaceInsights(storage, created.workspace, {
      days: 1,
      now: boundary,
    });

    expect(recap).toMatchObject({ from: '2026-08-04', to: '2026-08-04' });
    expect(recap.entries.at(0)?.date).toBe('2026-08-04');
    expect(insights.activity.at(-1)?.date).toBe('2026-08-04');
  });

  it('derives activity, evidence, provenance, and graph signals from local files', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    const created = await createTopic(storage, 'AI Fundamentals', now);
    await createNote(storage, created.topicSlug, 'Evidence map', now);
    await addSource(
      storage,
      {
        content: '# Reliable source\n\nA useful reference.',
        method: 'url',
        origin: {
          capturedAt: now.toISOString(),
          capturedVia: 'api-extract',
          provider: 'wikipedia',
        },
        title: 'Reliable source',
        topicSlug: created.topicSlug,
        url: 'https://example.com/reliable',
      },
      now,
    );

    const notePath = `Topics/${created.topicSlug}/Notes/evidence-map.md`;
    const note = await storage.read(notePath);
    await storage.write(notePath, `${note?.content ?? ''}\n\nSee [[../Overview]].\n`);

    const beforeEvents = await buildWorkspaceInsights(storage, created.workspace, { now });
    const threadId = `thread-${'a'.repeat(24)}`;
    await storage.write(
      `Topics/${created.topicSlug}/research.json`,
      `${JSON.stringify({
        activeThreadId: threadId,
        dismissed: [],
        events: [
          {
            at: now.toISOString(),
            eventId: `event-${'b'.repeat(24)}`,
            questionText: 'What matters?',
            threadId,
            type: 'question-created',
          },
        ],
        schemaVersion: 1,
        threads: [
          {
            createdAt: now.toISOString(),
            outputStyle: 'brief',
            questionText: 'What matters?',
            tags: ['research/thread'],
            threadId,
          },
        ],
        topicSlug: created.topicSlug,
      })}\n`,
    );
    const insights = await buildWorkspaceInsights(storage, created.workspace, { now });

    expect(insights.totals.artifactCount).toBe(beforeEvents.totals.artifactCount);
    expect(insights.artifactMix).toEqual(beforeEvents.artifactMix);
    expect(insights.tags).toEqual(beforeEvents.tags);
    expect(insights.totals).toMatchObject({
      activeDays: 1,
      noteCount: 2,
      objectiveCompleted: 0,
      objectiveTotal: 3,
      sourceCount: 1,
      topicCount: 1,
      unresolvedLinks: 0,
    });
    expect(insights.totals.artifactCount).toBeGreaterThanOrEqual(8);
    expect(insights.totals.connectedArtifactPercent).toBeGreaterThan(0);
    expect(insights.providers).toEqual([{ count: 1, id: 'wikipedia', label: 'Wikipedia' }]);
    expect(insights.topics[0]).toMatchObject({
      activityCount: 5,
      noteCount: 2,
      objectivePercent: 0,
      sourceCount: 1,
      title: 'AI Fundamentals',
    });
    expect(insights.activity.at(-1)).toMatchObject({ date: '2026-07-27' });
    expect(insights.activity.at(-1)?.count).toBe(5);
    expect(insights.hubs.some((hub) => hub.label === 'AI Fundamentals')).toBe(true);
  });

  it('reports an empty workspace without inventing learning activity', async () => {
    const storage = new MemoryStorageAdapter();
    const workspace = await createWorkspace(storage, 'Dusori', now);

    const insights = await buildWorkspaceInsights(storage, workspace, { now });

    expect(insights.totals).toMatchObject({
      activeDays: 0,
      connectedArtifactPercent: 0,
      objectiveCompleted: 0,
      objectiveTotal: 0,
      sourceCount: 0,
      topicCount: 0,
    });
    expect(insights.providers).toEqual([]);
    expect(insights.topics).toEqual([]);
  });

  it('derives a tag distribution ordered by count then name', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    const created = await createTopic(storage, 'Cloud', now);
    await storage.write(
      `Topics/${created.topicSlug}/Notes/vnet.md`,
      `---\ntitle: Virtual networks\ntags: [azure, networking]\n---\n\nBody.`,
    );
    await storage.write(
      `Topics/${created.topicSlug}/Notes/identity.md`,
      `---\ntitle: Identity\n---\n\nManaged identity. #azure`,
    );

    const insights = await buildWorkspaceInsights(storage, created.workspace, { now });

    expect(insights.tags).toEqual([
      { count: 2, tag: 'azure' },
      { count: 1, tag: 'networking' },
    ]);
  });

  it('derives review pressure from each topic review file', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    const overdue = await createTopic(storage, 'Overdue topic', now);
    const dueToday = await createTopic(storage, 'Due today', now);
    const later = await createTopic(storage, 'Later topic', now);
    const created = await createTopic(storage, 'Never reviewed', now);
    const today = localDateOf(now);

    await writeSchedule(storage, overdue.topicSlug, addDaysUtc(today, -3));
    await writeSchedule(storage, dueToday.topicSlug, today);
    await writeSchedule(storage, later.topicSlug, addDaysUtc(today, 5));

    const insights = await buildWorkspaceInsights(storage, created.workspace, { now });

    expect(insights.reviewPressure).toMatchObject({
      dueToday: 1,
      overdue: 1,
      scheduled: 3,
      unscheduled: 1,
    });
  });

  it('bounds the upcoming review histogram to the insight window starting today', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    const soon = await createTopic(storage, 'Soon', now);
    const created = await createTopic(storage, 'Far beyond the window', now);
    const today = localDateOf(now);

    await writeSchedule(storage, soon.topicSlug, addDaysUtc(today, 5));
    await writeSchedule(storage, created.topicSlug, addDaysUtc(today, 90));

    const insights = await buildWorkspaceInsights(storage, created.workspace, { days: 14, now });

    expect(insights.reviewPressure.upcoming).toHaveLength(14);
    expect(insights.reviewPressure.upcoming[0]?.date).toBe(today);
    expect(insights.reviewPressure.upcoming[5]).toEqual({ count: 1, date: addDaysUtc(today, 5) });
    expect(insights.reviewPressure.upcoming.reduce((total, point) => total + point.count, 0)).toBe(
      1,
    );
  });

  it('reports no pressure when nothing has ever been reviewed', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    const created = await createTopic(storage, 'Fresh', now);

    const insights = await buildWorkspaceInsights(storage, created.workspace, { now });

    expect(insights.reviewPressure).toMatchObject({
      dueToday: 0,
      overdue: 0,
      scheduled: 0,
      unscheduled: 1,
    });
  });

  it('ignores an unreadable review file instead of failing the whole report', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    const created = await createTopic(storage, 'Broken', now);
    await storage.write(`Topics/${created.topicSlug}/review.json`, '{ not json');

    const insights = await buildWorkspaceInsights(storage, created.workspace, { now });

    expect(insights.reviewPressure.scheduled).toBe(0);
    expect(insights.reviewPressure.unscheduled).toBe(1);
  });
});
