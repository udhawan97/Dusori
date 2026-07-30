import { describe, expect, it } from 'vitest';

import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace } from '../workspace/create.js';
import { acceptMarkdownUpdate, proposeMarkdownUpdate } from './write-protocol.js';
import {
  proposalLedgerPath,
  readPendingProposals,
  readProposalLedger,
  resolvePendingProposal,
} from './proposal-ledger.js';

const now = new Date('2026-07-30T12:00:00.000Z');

async function createConflict() {
  const storage = new MemoryStorageAdapter();
  await createWorkspace(storage, 'Dusori', now);
  const topic = await createTopic(storage, 'Durable proposals', now);
  const currentPath = `Topics/${topic.topicSlug}/roadmap.md`;
  await storage.externalWrite(
    currentPath,
    `${(await storage.read(currentPath))!.content}\nExternal change.\n`,
  );
  const conflict = await proposeMarkdownUpdate(
    storage,
    topic.topicSlug,
    'roadmap.md',
    '# Proposed roadmap\n',
    new Date('2026-07-30T12:05:00.000Z'),
  );
  if (!('proposalPath' in conflict)) throw new Error('Expected a proposal.');
  return { conflict, storage, topic };
}

describe('proposal ledger', () => {
  it('records new conflicts as durable pending proposals', async () => {
    const { conflict, storage, topic } = await createConflict();

    expect(await storage.read(proposalLedgerPath(topic.topicSlug))).not.toBeNull();
    expect(await readPendingProposals(storage, topic.topicSlug)).toEqual([
      expect.objectContaining({
        currentPath: conflict.currentPath,
        proposalPath: conflict.proposalPath,
        resolution: 'pending',
        topicSlug: topic.topicSlug,
      }),
    ]);
  });

  it('resolves a proposal without changing either Markdown file', async () => {
    const { conflict, storage, topic } = await createConflict();
    const currentBefore = await storage.read(conflict.currentPath);
    const proposalBefore = await storage.read(conflict.proposalPath);

    await resolvePendingProposal(
      storage,
      topic.topicSlug,
      conflict.proposalPath,
      'kept',
      new Date('2026-07-30T12:10:00.000Z'),
    );

    expect(await readPendingProposals(storage, topic.topicSlug)).toEqual([]);
    expect(await storage.read(conflict.currentPath)).toEqual(currentBefore);
    expect(await storage.read(conflict.proposalPath)).toEqual(proposalBefore);
    expect((await readProposalLedger(storage, topic.topicSlug)).proposals[0]).toMatchObject({
      resolution: 'kept',
      resolvedAt: '2026-07-30T12:10:00.000Z',
    });
  });

  it('marks an accepted proposal resolved after the guarded Markdown write', async () => {
    const { conflict, storage, topic } = await createConflict();

    await acceptMarkdownUpdate(
      storage,
      topic.topicSlug,
      'roadmap.md',
      conflict.proposalContent,
      conflict.currentContentHash,
      new Date('2026-07-30T12:10:00.000Z'),
      undefined,
      conflict.proposalPath,
    );

    expect((await storage.read(conflict.currentPath))?.content).toBe(conflict.proposalContent);
    expect(await readPendingProposals(storage, topic.topicSlug)).toEqual([]);
    expect((await readProposalLedger(storage, topic.topicSlug)).proposals[0]).toMatchObject({
      resolution: 'accepted',
      resolvedAt: '2026-07-30T12:10:00.000Z',
    });
  });

  it('rejects a ledger whose paths escape its recorded topic', async () => {
    const { storage, topic } = await createConflict();
    const path = proposalLedgerPath(topic.topicSlug);
    const ledger = JSON.parse((await storage.read(path))!.content) as {
      proposals: Array<{ currentPath: string }>;
    };
    ledger.proposals[0]!.currentPath = 'Topics/another-topic/roadmap.md';
    await storage.externalWrite(path, `${JSON.stringify(ledger)}\n`);

    await expect(readProposalLedger(storage, topic.topicSlug)).rejects.toThrow(
      /proposal ledger is invalid/iu,
    );
  });

  it('does not infer unrecorded legacy proposal files as pending', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    const topic = await createTopic(storage, 'Legacy proposal', now);
    await storage.write(
      `Topics/${topic.topicSlug}/roadmap.proposed-2026-07-01T12-00-00-000Z.md`,
      '# Historical proposal\n',
    );

    expect(await readPendingProposals(storage, topic.topicSlug)).toEqual([]);
  });
});
