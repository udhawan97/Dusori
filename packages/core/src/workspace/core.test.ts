import { describe, expect, it } from 'vitest';

import { acceptMarkdownUpdate, proposeMarkdownUpdate } from '../conflict/write-protocol.js';
import { readPendingProposals, readProposalLedger } from '../conflict/proposal-ledger.js';
import {
  clearWorkspace,
  exportWorkspace,
  importWorkspace,
  prepareWorkspaceImport,
  replaceWorkspace,
  workspaceImportRecoveryRoot,
} from '../portable.js';
import {
  preflightMachineFile,
  quarantineInvalidMachineFile,
  readMachineFile,
} from '../schemas/read-machine-file.js';
import { WorkspaceSchema } from '../schemas/workspace.js';
import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace, workspaceFingerprint } from './create.js';
import { coordinateStorage } from './coordinated-storage.js';
import { normalizeWorkspacePath, slugify } from './paths.js';

const now = new Date('2026-07-20T12:00:00.000Z');

describe('workspace path rules', () => {
  it('creates portable slugs and rejects traversal or Windows reserved names', () => {
    expect(slugify('Azure AI — First Look')).toBe('azure-ai-first-look');
    expect(() => slugify('CON')).toThrow(/portable/u);
    expect(() => normalizeWorkspacePath('../private')).toThrow(/parent/u);
    expect(() => normalizeWorkspacePath('/absolute')).toThrow(/relative/u);
  });
});

describe('workspace vertical slice', () => {
  it('creates the canonical topic tree', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    const created = await createTopic(storage, 'AI Fundamentals', now);
    const files = (await storage.list('', true))
      .filter((entry) => entry.kind === 'file')
      .map((entry) => entry.path);

    expect(created.topicSlug).toBe('ai-fundamentals');
    expect(files).toEqual(
      expect.arrayContaining([
        'Home.md',
        'dusori.json',
        'Topics/ai-fundamentals/Overview.md',
        'Topics/ai-fundamentals/roadmap.md',
        'Topics/ai-fundamentals/TUTOR.md',
        'Topics/ai-fundamentals/state.json',
        'Topics/ai-fundamentals/Notes/001-first-look.md',
        'Topics/ai-fundamentals/Updates/2026/07/2026-07-20.md',
        'Topics/ai-fundamentals/Sources/manifest.json',
      ]),
    );
  });

  it('persists certification intent in the workspace index and topic state', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    const created = await createTopic(storage, 'AI-103', now, { kind: 'certification' });

    expect(created.workspace.topics[0]?.kind).toBe('certification');
    expect(created.state.kind).toBe('certification');
    expect(JSON.parse((await storage.read('dusori.json'))!.content).topics[0].kind).toBe(
      'certification',
    );
  });

  it('preserves an external edit and writes a proposed file plus update entry', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    const created = await createTopic(storage, 'AI Fundamentals', now);
    const notePath = created.notePath;
    await storage.externalWrite(notePath, '# My external edit\n\nKeep this.\n');

    const result = await proposeMarkdownUpdate(
      storage,
      created.topicSlug,
      'Notes/001-first-look.md',
      '# Dusori proposal\n',
      new Date('2026-07-20T12:30:00.000Z'),
    );

    expect('proposalPath' in result).toBe(true);
    expect((await storage.read(notePath))?.content).toContain('Keep this.');
    if ('proposalPath' in result) {
      expect((await storage.read(result.proposalPath))?.content).toBe('# Dusori proposal\n');
      expect((await storage.read(result.updatePath))?.content).toContain('Conflict detected');
      await acceptMarkdownUpdate(
        storage,
        created.topicSlug,
        'Notes/001-first-look.md',
        result.proposalContent,
        result.currentContentHash,
        new Date('2026-07-20T12:31:00.000Z'),
        undefined,
        result.proposalPath,
      );
      expect((await storage.read(notePath))?.content).toBe('# Dusori proposal\n');
      expect((await storage.read(result.updatePath))?.content).toContain(
        'Accepted an explicit update',
      );
      expect((await readProposalLedger(storage, created.topicSlug)).proposals[0]).toMatchObject({
        resolution: 'accepted',
      });
    }
  });

  it('preserves pending proposal decisions through workspace export and import', async () => {
    const source = new MemoryStorageAdapter();
    await createWorkspace(source, 'Dusori', now);
    const created = await createTopic(source, 'AI Fundamentals', now);
    await source.externalWrite(created.notePath, '# External note\n');
    const conflict = await proposeMarkdownUpdate(
      source,
      created.topicSlug,
      'Notes/001-first-look.md',
      '# Proposed note\n',
      now,
    );
    if (!('proposalPath' in conflict)) throw new Error('Expected a proposal.');

    const target = new MemoryStorageAdapter();
    await importWorkspace(target, await exportWorkspace(source));

    expect(await readPendingProposals(target, created.topicSlug)).toEqual([
      expect.objectContaining({
        currentPath: conflict.currentPath,
        proposalPath: conflict.proposalPath,
      }),
    ]);
  });

  it('rejects an invalid topic state without writing partial files', async () => {
    const source = new MemoryStorageAdapter();
    await createWorkspace(source, 'Dusori', now);
    const created = await createTopic(source, 'AI Fundamentals', now);
    await source.externalWrite(`Topics/${created.topicSlug}/state.json`, '{broken');

    const target = new MemoryStorageAdapter();
    await expect(importWorkspace(target, await exportWorkspace(source))).rejects.toThrow(
      /topic state is invalid/u,
    );
    expect(await target.list('', true)).toEqual([]);
  });

  it('exports, clears, and imports a logically identical workspace', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    await createTopic(storage, 'AI Fundamentals', now);
    const before = await workspaceFingerprint(storage);
    const archive = await exportWorkspace(storage);
    await clearWorkspace(storage);
    await importWorkspace(storage, archive);
    expect(await workspaceFingerprint(storage)).toBe(before);
  });

  it('preflights an archive without touching the destination workspace', async () => {
    const source = new MemoryStorageAdapter();
    await createWorkspace(source, 'Imported learning', now);
    await createTopic(source, 'AI Fundamentals', now);

    const destination = new MemoryStorageAdapter();
    await createWorkspace(destination, 'Keep me', now);
    await createTopic(destination, 'Typography', now);
    const before = await workspaceFingerprint(destination);

    const prepared = await prepareWorkspaceImport(await exportWorkspace(source));

    expect(prepared.preview).toMatchObject({
      fileCount: 9,
      topicCount: 1,
      workspaceName: 'Imported learning',
    });
    expect(prepared.preview.totalBytes).toBeGreaterThan(0);
    expect(await workspaceFingerprint(destination)).toBe(before);
  });

  it('preserves machine-file recovery bytes after a successful workspace replacement', async () => {
    const source = new MemoryStorageAdapter();
    await createWorkspace(source, 'Imported learning', now);
    await createTopic(source, 'AI Fundamentals', now);

    const destination = new MemoryStorageAdapter();
    await createWorkspace(destination, 'Keep me', now);
    const recoveryPath = '.dusori-recovery/dusori.json.invalid-original';
    const recoveryBytes = '{invalid workspace bytes';
    await destination.write(recoveryPath, recoveryBytes, { expectedHash: null });

    await importWorkspace(destination, await exportWorkspace(source));

    expect((await destination.read(recoveryPath))?.content).toBe(recoveryBytes);
    expect(
      await destination.read(`${workspaceImportRecoveryRoot}/backup/${recoveryPath}`),
    ).toBeNull();
    expect(
      (await destination.list('', true)).some((entry) =>
        entry.path.startsWith(`${workspaceImportRecoveryRoot}/`),
      ),
    ).toBe(false);
  });

  it('preserves an existing import recovery root with a case-insensitive alias', async () => {
    const source = new MemoryStorageAdapter();
    await createWorkspace(source, 'Imported learning', now);
    await createTopic(source, 'AI Fundamentals', now);

    const destination = new MemoryStorageAdapter();
    await createWorkspace(destination, 'Keep me', now);
    const recoveryPath = '.DUSORI-IMPORT-RECOVERY/backup/dusori.json';
    const recoveryBytes = '{previous recovery bytes';
    await destination.write(recoveryPath, recoveryBytes, { expectedHash: null });

    await expect(importWorkspace(destination, await exportWorkspace(source))).rejects.toThrow(
      /previous import left a durable recovery copy/u,
    );

    expect((await destination.read(recoveryPath))?.content).toBe(recoveryBytes);
  });

  it('rejects an invalid archive before replacing the destination workspace', async () => {
    const invalid = new MemoryStorageAdapter();
    await createWorkspace(invalid, 'Invalid import', now);
    const created = await createTopic(invalid, 'Broken topic', now);
    await invalid.externalWrite(`Topics/${created.topicSlug}/state.json`, '{broken');

    const destination = new MemoryStorageAdapter();
    await createWorkspace(destination, 'Keep me', now);
    const before = await workspaceFingerprint(destination);

    await expect(prepareWorkspaceImport(await exportWorkspace(invalid))).rejects.toThrow(
      /topic state is invalid/u,
    );
    expect(await workspaceFingerprint(destination)).toBe(before);
  });

  it('restores the destination when applying a valid archive fails', async () => {
    class FailingStorageAdapter extends MemoryStorageAdapter {
      failNextImport = false;

      override async write(
        path: string,
        content: string,
        options?: Parameters<MemoryStorageAdapter['write']>[2],
      ) {
        if (this.failNextImport && path.endsWith('/state.json')) {
          this.failNextImport = false;
          throw new Error('simulated storage failure');
        }
        return super.write(path, content, options);
      }
    }

    const source = new MemoryStorageAdapter();
    await createWorkspace(source, 'Imported learning', now);
    await createTopic(source, 'AI Fundamentals', now);
    const prepared = await prepareWorkspaceImport(await exportWorkspace(source));

    const destination = new FailingStorageAdapter();
    await createWorkspace(destination, 'Keep me', now);
    await createTopic(destination, 'Typography', now);
    const before = await workspaceFingerprint(destination);
    destination.failNextImport = true;

    await expect(replaceWorkspace(destination, prepared)).rejects.toThrow(
      /simulated storage failure/u,
    );
    expect(await workspaceFingerprint(destination)).toBe(before);
  });

  it('rejects queued app writes that belong to the replaced workspace', async () => {
    let releaseStaging = (): void => undefined;
    let reportStaging = (): void => undefined;
    const stagingPaused = new Promise<void>((resolve) => {
      reportStaging = resolve;
    });
    const continueStaging = new Promise<void>((resolve) => {
      releaseStaging = resolve;
    });
    class PausingStorageAdapter extends MemoryStorageAdapter {
      override async ensureDirectory(path: string): Promise<void> {
        await super.ensureDirectory(path);
        if (path === `${workspaceImportRecoveryRoot}/staged`) {
          reportStaging();
          await continueStaging;
        }
      }
    }

    const source = new MemoryStorageAdapter();
    await createWorkspace(source, 'Imported learning', now);
    await createTopic(source, 'AI Fundamentals', now);
    const prepared = await prepareWorkspaceImport(await exportWorkspace(source));

    const raw = new PausingStorageAdapter();
    await createWorkspace(raw, 'Keep me', now);
    const destination = coordinateStorage(raw);
    const replacement = replaceWorkspace(destination, prepared);
    await stagingPaused;
    const laterEdit = destination.write('Home.md', '# Written while import was staging\n');
    const staleWrite = expect(laterEdit).rejects.toThrow(/workspace was replaced/u);
    releaseStaging();
    await Promise.all([replacement, staleWrite]);

    expect((await destination.read('Home.md'))?.content).toBe(
      (await source.read('Home.md'))?.content,
    );
    expect(JSON.parse((await destination.read('dusori.json'))!.content).name).toBe(
      'Imported learning',
    );
    await destination.write('Home.md', '# Deliberate edit after import\n');
    expect((await destination.read('Home.md'))?.content).toBe('# Deliberate edit after import\n');
  });

  it('aborts before clearing live files when an external edit arrives during staging', async () => {
    let releaseStaging = (): void => undefined;
    let reportStaging = (): void => undefined;
    const stagingPaused = new Promise<void>((resolve) => {
      reportStaging = resolve;
    });
    const continueStaging = new Promise<void>((resolve) => {
      releaseStaging = resolve;
    });
    class PausingStorageAdapter extends MemoryStorageAdapter {
      override async ensureDirectory(path: string): Promise<void> {
        await super.ensureDirectory(path);
        if (path === `${workspaceImportRecoveryRoot}/staged`) {
          reportStaging();
          await continueStaging;
        }
      }
    }

    const source = new MemoryStorageAdapter();
    await createWorkspace(source, 'Imported learning', now);
    await createTopic(source, 'AI Fundamentals', now);
    const prepared = await prepareWorkspaceImport(await exportWorkspace(source));

    const destination = new PausingStorageAdapter();
    await createWorkspace(destination, 'Keep me', now);
    const replacement = replaceWorkspace(destination, prepared);
    await stagingPaused;
    await destination.externalWrite('Home.md', '# External edit kept\n');
    releaseStaging();

    await expect(replacement).rejects.toThrow(/changed while the replacement was being staged/u);
    expect((await destination.read('Home.md'))?.content).toBe('# External edit kept\n');
    expect(JSON.parse((await destination.read('dusori.json'))!.content).name).toBe('Keep me');
    expect(await destination.read(`${workspaceImportRecoveryRoot}/backup/dusori.json`)).toBeNull();
  });

  it('restores an external edit that lands immediately before the first live removal', async () => {
    class LateEditStorageAdapter extends MemoryStorageAdapter {
      injectLateEdit = false;

      override async move(from: string, to: string): Promise<void> {
        if (this.injectLateEdit && !from.startsWith(`${workspaceImportRecoveryRoot}/`)) {
          this.injectLateEdit = false;
          await this.externalWrite('Home.md', '# External edit at commit boundary\n');
        }
        await super.move(from, to);
      }
    }

    const source = new MemoryStorageAdapter();
    await createWorkspace(source, 'Imported learning', now);
    await createTopic(source, 'AI Fundamentals', now);
    const prepared = await prepareWorkspaceImport(await exportWorkspace(source));

    const destination = new LateEditStorageAdapter();
    await createWorkspace(destination, 'Keep me', now);
    destination.injectLateEdit = true;

    await expect(replaceWorkspace(destination, prepared)).rejects.toThrow(
      /changed immediately before replacement/u,
    );
    expect((await destination.read('Home.md'))?.content).toBe(
      '# External edit at commit boundary\n',
    );
    expect(JSON.parse((await destination.read('dusori.json'))!.content).name).toBe('Keep me');
  });

  it('refuses replacement before staging when the adapter cannot relocate safely', async () => {
    class UnsafeMoveStorageAdapter extends MemoryStorageAdapter {
      override readonly supportsSafeWorkspaceRelocation = false;
    }

    const source = new MemoryStorageAdapter();
    await createWorkspace(source, 'Imported learning', now);
    const prepared = await prepareWorkspaceImport(await exportWorkspace(source));

    const destination = new UnsafeMoveStorageAdapter();
    await createWorkspace(destination, 'Keep me', now);
    const before = await workspaceFingerprint(destination);

    await expect(replaceWorkspace(destination, prepared)).rejects.toThrow(
      /storage target cannot safely replace the workspace/u,
    );
    expect(await workspaceFingerprint(destination)).toBe(before);
    expect(await destination.read(`${workspaceImportRecoveryRoot}/backup/dusori.json`)).toBeNull();
  });

  it('fails closed when an adapter does not declare safe workspace relocation', async () => {
    const source = new MemoryStorageAdapter();
    await createWorkspace(source, 'Imported learning', now);
    const prepared = await prepareWorkspaceImport(await exportWorkspace(source));

    const destination = new MemoryStorageAdapter();
    await createWorkspace(destination, 'Keep me', now);
    Reflect.deleteProperty(destination, 'supportsSafeWorkspaceRelocation');
    const before = await workspaceFingerprint(destination);

    await expect(replaceWorkspace(destination, prepared)).rejects.toThrow(
      /storage target cannot safely replace the workspace/u,
    );
    expect(await workspaceFingerprint(destination)).toBe(before);
  });

  it('preserves a file recreated externally before a failed import write', async () => {
    class RecreatedFileStorageAdapter extends MemoryStorageAdapter {
      failNextLiveWrite = false;

      override async write(
        path: string,
        content: string,
        options?: Parameters<MemoryStorageAdapter['write']>[2],
      ) {
        if (this.failNextLiveWrite && !path.startsWith(`${workspaceImportRecoveryRoot}/`)) {
          this.failNextLiveWrite = false;
          await this.externalWrite('External.md', '# Recreated by an external editor\n');
          throw new Error('simulated import write failure');
        }
        return super.write(path, content, options);
      }
    }

    const source = new MemoryStorageAdapter();
    await createWorkspace(source, 'Imported learning', now);
    const prepared = await prepareWorkspaceImport(await exportWorkspace(source));

    const destination = new RecreatedFileStorageAdapter();
    await createWorkspace(destination, 'Keep me', now);
    destination.failNextLiveWrite = true;

    await expect(replaceWorkspace(destination, prepared)).rejects.toThrow(
      /previous workspace was restored/u,
    );
    expect(JSON.parse((await destination.read('dusori.json'))!.content).name).toBe('Keep me');
    expect(
      (await destination.read(`${workspaceImportRecoveryRoot}/failed-import/External.md`))?.content,
    ).toBe('# Recreated by an external editor\n');
  });

  it('keeps a durable untouched backup when both replacement and restoration writes fail', async () => {
    class PersistentlyFailingStorageAdapter extends MemoryStorageAdapter {
      failLiveWrites = false;

      override async move(from: string, to: string): Promise<void> {
        if (
          this.failLiveWrites &&
          from.startsWith(`${workspaceImportRecoveryRoot}/`) &&
          !to.startsWith(`${workspaceImportRecoveryRoot}/`)
        ) {
          throw new Error('persistent restoration failure');
        }
        await super.move(from, to);
      }

      override async write(
        path: string,
        content: string,
        options?: Parameters<MemoryStorageAdapter['write']>[2],
      ) {
        if (this.failLiveWrites && !path.startsWith(`${workspaceImportRecoveryRoot}/`)) {
          throw new Error('persistent device failure');
        }
        return super.write(path, content, options);
      }
    }

    const source = new MemoryStorageAdapter();
    await createWorkspace(source, 'Imported learning', now);
    await createTopic(source, 'AI Fundamentals', now);
    const prepared = await prepareWorkspaceImport(await exportWorkspace(source));

    const destination = new PersistentlyFailingStorageAdapter();
    await createWorkspace(destination, 'Keep me', now);
    await createTopic(destination, 'Typography', now);
    const originalWorkspace = (await destination.read('dusori.json'))?.content;
    destination.failLiveWrites = true;

    await expect(replaceWorkspace(destination, prepared)).rejects.toThrow(
      /untouched durable backup remains/u,
    );
    expect(
      (await destination.read(`${workspaceImportRecoveryRoot}/backup/dusori.json`))?.content,
    ).toBe(originalWorkspace);
    expect(
      (await destination.list(workspaceImportRecoveryRoot, true)).some(
        (entry) => entry.path === `${workspaceImportRecoveryRoot}/backup/dusori.json`,
      ),
    ).toBe(true);
  });

  it('preflights and reads invalid machine state without moving it until repair is explicit', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.write('dusori.json', '{not json', { expectedHash: null });

    expect(await preflightMachineFile(storage, 'dusori.json', WorkspaceSchema)).toMatchObject({
      path: 'dusori.json',
      status: 'invalid',
    });
    await expect(readMachineFile(storage, 'dusori.json', WorkspaceSchema, now)).rejects.toThrow(
      /preserved/u,
    );
    expect((await storage.read('dusori.json'))?.content).toBe('{not json');
    expect((await storage.list('', true)).some((entry) => entry.path.includes('.invalid-'))).toBe(
      false,
    );

    const invalidPath = await quarantineInvalidMachineFile(
      storage,
      'dusori.json',
      WorkspaceSchema,
      now,
    );
    const quarantined = (await storage.list('', true)).find((entry) =>
      entry.path.includes('.invalid-'),
    );
    expect(quarantined?.path).toBe(invalidPath);
    expect(await storage.read('dusori.json')).toBeNull();
  });
});
