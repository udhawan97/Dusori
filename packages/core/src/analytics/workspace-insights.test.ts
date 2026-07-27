import { describe, expect, it } from 'vitest';

import { createNote } from '../notes/edit.js';
import { addSource } from '../sources/import.js';
import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace } from '../workspace/create.js';
import { buildWorkspaceInsights } from './workspace-insights.js';

const now = new Date('2026-07-27T12:00:00.000Z');

describe('workspace insights', () => {
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

    const insights = await buildWorkspaceInsights(storage, created.workspace, { now });

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
});
