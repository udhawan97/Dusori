import { describe, expect, it } from 'vitest';

import { StorageConflictError } from '../adapters.js';
import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace } from '../workspace/create.js';
import { applyMachineFileRecovery, inspectMachineFileRecoveries } from './machine-file-recovery.js';
import { SourceManifestSchema } from './workspace.js';

const now = new Date('2026-08-31T12:00:00.000Z');

describe('machine-file recovery', () => {
  it('inspects invalid files without mutating them and proposes a bounded source repair', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Research desk', now);
    await createTopic(storage, 'Attention', now);
    const path = 'Topics/attention/Sources/manifest.json';
    const invalid = `${JSON.stringify({ schemaVersion: 1, sources: [{ title: 'missing fields' }] })}\n`;
    await storage.externalWrite(path, invalid);

    const before = await storage.list('', true);
    const [plan] = await inspectMachineFileRecoveries(storage, now);

    expect(plan).toMatchObject({
      kind: 'source-manifest',
      originalExcerpt: invalid,
      path,
    });
    expect(plan?.repairSummary).toContain('Keep 0 of 1 valid source record');
    expect(SourceManifestSchema.parse(JSON.parse(plan?.proposedContent ?? '{}'))).toEqual({
      schemaVersion: 1,
      sources: [],
    });
    expect((await storage.read(path))?.content).toBe(invalid);
    expect(await storage.list('', true)).toEqual(before);
  });

  it('archives exact original bytes before applying the reviewed hash-guarded repair', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Research desk', now);
    await createTopic(storage, 'Attention', now);
    const path = 'Topics/attention/research.json';
    const invalid = '{"schemaVersion":1,"topicSlug":"wrong","dismissed":[]}\n';
    await storage.write(path, invalid, { expectedHash: null });
    const [plan] = await inspectMachineFileRecoveries(storage, now);

    const applied = await applyMachineFileRecovery(storage, plan!, now);

    expect((await storage.read(applied.archivePath))?.content).toBe(invalid);
    expect(JSON.parse((await storage.read(path))?.content ?? '{}')).toEqual({
      dismissed: [],
      schemaVersion: 1,
      topicSlug: 'attention',
    });
    expect(
      (await inspectMachineFileRecoveries(storage, now)).map((item) => item.path),
    ).not.toContain(path);
  });

  it('fails closed when the file changes after preview', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Research desk', now);
    await createTopic(storage, 'Attention', now);
    const path = 'Topics/attention/proposals.json';
    await storage.write(path, '{bad json', { expectedHash: null });
    const [plan] = await inspectMachineFileRecoveries(storage, now);
    await storage.externalWrite(path, '{different bad json');

    await expect(applyMachineFileRecovery(storage, plan!, now)).rejects.toBeInstanceOf(
      StorageConflictError,
    );
    expect(
      (await storage.list('.dusori-recovery', true)).filter((entry) => entry.kind === 'file'),
    ).toEqual([]);
  });

  it('reconstructs an invalid workspace index from valid topic state without changing topic files', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Research desk', now);
    await createTopic(storage, 'Attention Systems', now);
    const stateBefore = (await storage.read('Topics/attention-systems/state.json'))?.content;
    await storage.externalWrite('dusori.json', '{not json');

    const [plan] = await inspectMachineFileRecoveries(storage, now);
    expect(plan).toMatchObject({ kind: 'workspace-index', path: 'dusori.json' });
    expect(JSON.parse(plan?.proposedContent ?? '{}')).toMatchObject({
      name: 'Recovered research workspace',
      topics: [{ slug: 'attention-systems', title: 'Attention Systems' }],
    });

    await applyMachineFileRecovery(storage, plan!, now);
    expect((await storage.read('Topics/attention-systems/state.json'))?.content).toBe(stateBefore);
  });

  it('shows an invalid review schedule without inventing a review outcome', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Research desk', now);
    await createTopic(storage, 'Attention', now);
    await storage.write('Topics/attention/review.json', '{bad json', { expectedHash: null });

    const [plan] = await inspectMachineFileRecoveries(storage, now);
    expect(plan).toMatchObject({ kind: 'review-schedule', proposedContent: undefined });
    expect(plan?.repairSummary).toMatch(/falsely claim that a review happened/u);
    await expect(applyMachineFileRecovery(storage, plan!, now)).rejects.toThrow(
      /no safe automatic repair/u,
    );
  });
});
