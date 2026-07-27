import { describe, expect, it } from 'vitest';

import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace } from '../workspace/create.js';
import { createMissingLinkTarget, isCreatableLinkTarget } from './health-actions.js';
import { inspectWorkspaceHealth } from './workspace-health.js';
import { buildWorkspaceGraph } from './workspace-graph.js';

const now = new Date('2026-07-27T12:00:00.000Z');

async function topicLinkingTo(target: string): Promise<{
  slug: string;
  storage: MemoryStorageAdapter;
}> {
  const storage = new MemoryStorageAdapter();
  await createWorkspace(storage, 'Dusori', now);
  const created = await createTopic(storage, 'Cloud native', now);
  await storage.write(
    `Topics/${created.topicSlug}/Notes/index.md`,
    `---\ntitle: Index\n---\n\nSee [[${target}]].\n`,
  );
  return { slug: created.topicSlug, storage };
}

async function unresolvedIssue(storage: MemoryStorageAdapter, target: string) {
  const health = await inspectWorkspaceHealth(storage);
  return health.issues.find(
    (issue) => issue.kind === 'unresolved-link' && issue.target === target,
  )!;
}

describe('isCreatableLinkTarget', () => {
  it('accepts a plain name', async () => {
    const { storage } = await topicLinkingTo('Missing note');

    expect(isCreatableLinkTarget(await unresolvedIssue(storage, 'Missing note'))).toBe(true);
  });

  it('accepts a path inside the topic', async () => {
    const { storage } = await topicLinkingTo('Notes/deeper');

    expect(isCreatableLinkTarget(await unresolvedIssue(storage, 'Notes/deeper'))).toBe(true);
  });

  it('refuses a target that climbs out of the topic', async () => {
    const { storage } = await topicLinkingTo('../../escape');

    expect(isCreatableLinkTarget(await unresolvedIssue(storage, '../../escape'))).toBe(false);
  });

  it('refuses an issue that is not an unresolved link', () => {
    expect(
      isCreatableLinkTarget({
        kind: 'invalid-source-manifest',
        message: 'Invalid.',
        path: 'Topics/cloud-native/Sources/manifest.json',
        topicSlug: 'cloud-native',
      }),
    ).toBe(false);
  });
});

describe('createMissingLinkTarget', () => {
  it('creates the file at the exact name so the wikilink actually resolves', async () => {
    const { slug, storage } = await topicLinkingTo('Missing note');

    const created = await createMissingLinkTarget(
      storage,
      await unresolvedIssue(storage, 'Missing note'),
      now,
    );

    expect(created.path).toBe(`Topics/${slug}/Notes/Missing note.md`);
    const graph = await buildWorkspaceGraph(storage);
    expect(graph.unresolvedLinks).toEqual([]);
  });

  it('creates a nested target inside the topic', async () => {
    const { slug, storage } = await topicLinkingTo('Notes/deeper');

    const created = await createMissingLinkTarget(
      storage,
      await unresolvedIssue(storage, 'Notes/deeper'),
      now,
    );

    expect(created.path).toBe(`Topics/${slug}/Notes/deeper.md`);
  });

  it('records the new file in topic state so later edits are conflict-safe', async () => {
    const { slug, storage } = await topicLinkingTo('Missing note');

    const created = await createMissingLinkTarget(
      storage,
      await unresolvedIssue(storage, 'Missing note'),
      now,
    );

    expect(created.state.fileIndex[`Topics/${slug}/Notes/Missing note.md`]).toBeTruthy();
  });

  it('appends a dated update entry naming what it created', async () => {
    const { storage } = await topicLinkingTo('Missing note');

    const created = await createMissingLinkTarget(
      storage,
      await unresolvedIssue(storage, 'Missing note'),
      now,
    );
    const update = await storage.read(created.updatePath);

    expect(update?.content).toContain('Missing note');
  });

  it('says in the new file which document linked to it', async () => {
    const { slug, storage } = await topicLinkingTo('Missing note');

    const created = await createMissingLinkTarget(
      storage,
      await unresolvedIssue(storage, 'Missing note'),
      now,
    );

    expect(created.content).toContain(`Topics/${slug}/Notes/index.md`);
  });

  it('never overwrites a file that already exists', async () => {
    const { slug, storage } = await topicLinkingTo('Missing note');
    const issue = await unresolvedIssue(storage, 'Missing note');
    await storage.write(`Topics/${slug}/Notes/Missing note.md`, '# Mine\n\nWritten by hand.\n');

    await expect(createMissingLinkTarget(storage, issue, now)).rejects.toThrow(/already exists/iu);
    const kept = await storage.read(`Topics/${slug}/Notes/Missing note.md`);
    expect(kept?.content).toContain('Written by hand.');
  });

  it('refuses a target that climbs out of the topic', async () => {
    const { storage } = await topicLinkingTo('../../escape');

    await expect(
      createMissingLinkTarget(storage, await unresolvedIssue(storage, '../../escape'), now),
    ).rejects.toThrow(/inside its topic/iu);
  });

  it('refuses an issue that is not an unresolved link', async () => {
    const { storage } = await topicLinkingTo('Missing note');

    await expect(
      createMissingLinkTarget(
        storage,
        {
          kind: 'untracked-source-file',
          message: 'Untracked.',
          path: 'Topics/cloud-native/Sources/items/stray.md',
          topicSlug: 'cloud-native',
        },
        now,
      ),
    ).rejects.toThrow(/unresolved wikilink/iu);
  });
});
