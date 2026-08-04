import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { resolvePendingProposal } from '../conflict/proposal-ledger.js';
import { markTopicReviewed } from '../learning/review.js';
import { recordResearchRun } from '../research/research-file.js';
import { addSource } from '../sources/import.js';
import { createNote } from '../notes/edit.js';
import { createTopic } from '../workspace/create.js';
import { MemoryStorageAdapter } from './memory-storage.js';

const baselineCommit = '7798845f5dcdedcadc5fa6ff51f7992974656b04';
const now = new Date('2026-08-04T12:00:00.000Z');
const root = 'Topics/legacy-topic';

async function fixture(name: string): Promise<string> {
  return readFile(new URL(`./fixtures/v0.11.3/${name}`, import.meta.url), 'utf8');
}

async function jsonAt(
  storage: MemoryStorageAdapter,
  path: string,
): Promise<Record<string, unknown>> {
  const snapshot = await storage.read(path);
  if (!snapshot) throw new Error(`Missing fixture after mutation: ${path}`);
  return JSON.parse(snapshot.content) as Record<string, unknown>;
}

async function v0_11_3Workspace(): Promise<MemoryStorageAdapter> {
  const storage = new MemoryStorageAdapter();
  await storage.externalWrite('dusori.json', await fixture('dusori.json'));
  await storage.externalWrite('Home.md', '# Compatibility workspace\n');
  await storage.externalWrite(`${root}/state.json`, await fixture('state.json'));
  await storage.externalWrite(`${root}/Sources/manifest.json`, await fixture('manifest.json'));
  await storage.externalWrite(
    `${root}/Sources/items/legacy.md`,
    '# Legacy source\n\nA compatibility fixture is useful because it proves that mutation preserves unknown data.\n',
  );
  await storage.externalWrite(`${root}/research.json`, await fixture('research.json'));
  await storage.externalWrite(`${root}/review.json`, await fixture('review.json'));
  await storage.externalWrite(`${root}/proposals.json`, await fixture('proposals.json'));
  await storage.externalWrite(`${root}/roadmap.md`, '# Legacy roadmap\n');
  await storage.externalWrite(`${root}/roadmap.proposed-2026-07-20.md`, '# Proposed roadmap\n');
  return storage;
}

describe(`v0.11.3 machine-file compatibility (${baselineCommit})`, () => {
  it('preserves unknown workspace and topic-state fields through real mutations', async () => {
    const storage = await v0_11_3Workspace();

    await createTopic(storage, 'New topic', now);
    await createNote(storage, 'legacy-topic', 'Compatibility note', now);

    const workspace = await jsonAt(storage, 'dusori.json');
    expect(workspace).toMatchObject({
      futureWorkspaceField: { keep: true },
      schemaVersion: 1,
      fileIndex: { 'Home.md': { futureVersionField: 'keep' } },
    });
    expect((workspace.topics as Array<Record<string, unknown>>)[0]).toMatchObject({
      futureTopicField: { keep: true },
    });
    expect(await jsonAt(storage, `${root}/state.json`)).toMatchObject({
      futureStateField: { keep: true },
      schemaVersion: 1,
      fileIndex: {
        [`${root}/Overview.md`]: { futureVersionField: 'keep' },
      },
    });
  });

  it('preserves unknown source, research, review, and proposal fields through mutations', async () => {
    const storage = await v0_11_3Workspace();

    await addSource(
      storage,
      {
        content: '# Added source\n\nA learner supplied this authorized text.\n',
        method: 'url',
        title: 'Added source',
        topicSlug: 'legacy-topic',
        url: 'https://example.org/added',
      },
      now,
    );
    await recordResearchRun(
      storage,
      'legacy-topic',
      {
        candidates: [{ key: 'wikipedia:new' }],
        providers: [{ count: 1, id: 'wikipedia', label: 'Wikipedia', outcome: 'found' }],
        searchText: 'legacy topic compatibility',
      },
      now,
    );
    await markTopicReviewed(storage, 'legacy-topic', 'good', now);
    await resolvePendingProposal(
      storage,
      'legacy-topic',
      `${root}/roadmap.proposed-2026-07-20.md`,
      'kept',
      now,
    );

    const manifest = await jsonAt(storage, `${root}/Sources/manifest.json`);
    expect(manifest).toMatchObject({
      futureManifestField: { keep: true },
      schemaVersion: 1,
    });
    const legacySource = (manifest.sources as Array<Record<string, unknown>>)[0];
    expect(legacySource).toMatchObject({
      futureSourceField: { keep: true },
      origin: { futureOriginField: 'keep' },
    });
    expect((legacySource?.claims as Array<Record<string, unknown>>)[0]).toMatchObject({
      futureClaimField: 'keep',
    });

    const research = await jsonAt(storage, `${root}/research.json`);
    expect(research).toMatchObject({
      futureResearchField: { keep: true },
    });
    expect((research.dismissed as Array<Record<string, unknown>>)[0]).toMatchObject({
      futureDismissedField: 'keep',
    });
    const legacyRun = (research.runs as Array<Record<string, unknown>>)[0];
    expect(legacyRun).toMatchObject({ futureRunField: 'keep' });
    expect((legacyRun?.providers as Array<Record<string, unknown>>)[0]).toMatchObject({
      futureProviderField: 'keep',
    });
    expect((research.seen as Array<Record<string, unknown>>)[0]).toMatchObject({
      futureSeenField: 'keep',
    });
    expect(await jsonAt(storage, `${root}/review.json`)).toMatchObject({
      futureReviewField: { keep: true },
      schemaVersion: 1,
    });
    expect(await jsonAt(storage, `${root}/proposals.json`)).toMatchObject({
      futureLedgerField: { keep: true },
      proposals: [{ futureProposalField: 'keep', resolution: 'kept' }],
      schemaVersion: 1,
    });
  });
});
