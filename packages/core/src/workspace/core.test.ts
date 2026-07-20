import { describe, expect, it } from 'vitest';

import { acceptMarkdownUpdate, proposeMarkdownUpdate } from '../conflict/write-protocol.js';
import { clearWorkspace, exportWorkspace, importWorkspace } from '../portable.js';
import { readMachineFile } from '../schemas/read-machine-file.js';
import { WorkspaceSchema } from '../schemas/workspace.js';
import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace, workspaceFingerprint } from './create.js';
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
      );
      expect((await storage.read(notePath))?.content).toBe('# Dusori proposal\n');
      expect((await storage.read(result.updatePath))?.content).toContain(
        'Accepted an explicit update',
      );
    }
  });

  it('quarantines an invalid topic state during import', async () => {
    const source = new MemoryStorageAdapter();
    await createWorkspace(source, 'Dusori', now);
    const created = await createTopic(source, 'AI Fundamentals', now);
    await source.externalWrite(`Topics/${created.topicSlug}/state.json`, '{broken');

    const target = new MemoryStorageAdapter();
    await expect(importWorkspace(target, await exportWorkspace(source))).rejects.toThrow(
      /quarantined/u,
    );
    expect(
      (await target.list('', true)).some((entry) => entry.path.includes('state.json.invalid-')),
    ).toBe(true);
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

  it('quarantines invalid machine state instead of rewriting it', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.write('dusori.json', '{not json', { expectedHash: null });
    await expect(readMachineFile(storage, 'dusori.json', WorkspaceSchema, now)).rejects.toThrow(
      /quarantined/u,
    );
    const quarantined = (await storage.list('', true)).find((entry) =>
      entry.path.includes('.invalid-'),
    );
    expect(quarantined?.path).toContain('dusori.json.invalid-');
    expect(await storage.read('dusori.json')).toBeNull();
  });
});
