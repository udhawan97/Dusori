import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { exportTopic, prepareWorkspaceImport } from './portable.js';
import { MemoryStorageAdapter } from './testing/memory-storage.js';
import { createTopic, createWorkspace } from './workspace/create.js';

const now = new Date('2026-07-27T12:00:00.000Z');

async function twoTopicWorkspace(): Promise<MemoryStorageAdapter> {
  const storage = new MemoryStorageAdapter();
  await createWorkspace(storage, 'Dusori', now);
  await createTopic(storage, 'Cloud native', now);
  await createTopic(storage, 'Linear algebra', now);
  return storage;
}

async function pathsIn(archive: Uint8Array): Promise<string[]> {
  const zip = await JSZip.loadAsync(archive);
  return Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

describe('exportTopic', () => {
  it('includes every file of the named topic', async () => {
    const paths = await pathsIn(await exportTopic(await twoTopicWorkspace(), 'cloud-native'));

    expect(paths).toContain('Topics/cloud-native/Overview.md');
    expect(paths).toContain('Topics/cloud-native/roadmap.md');
    expect(paths).toContain('Topics/cloud-native/TUTOR.md');
    expect(paths).toContain('Topics/cloud-native/state.json');
  });

  it('leaves out every other topic and the workspace root', async () => {
    const paths = await pathsIn(await exportTopic(await twoTopicWorkspace(), 'cloud-native'));

    expect(paths.some((path) => path.startsWith('Topics/linear-algebra/'))).toBe(false);
    expect(paths).not.toContain('dusori.json');
    expect(paths).not.toContain('Home.md');
  });

  it('keeps workspace-relative paths so the bundle says where it came from', async () => {
    const paths = await pathsIn(await exportTopic(await twoTopicWorkspace(), 'cloud-native'));

    expect(paths.filter((path) => path.startsWith('Topics/cloud-native/')).length).toBeGreaterThan(
      0,
    );
  });

  it('adds a note saying the bundle is one topic and not an importable workspace', async () => {
    const zip = await JSZip.loadAsync(await exportTopic(await twoTopicWorkspace(), 'cloud-native'));
    const note = await zip.file('TOPIC-BUNDLE.md')?.async('string');

    expect(note).toBeTruthy();
    expect(note).toMatch(/not a complete workspace/iu);
    expect(note).toContain('cloud-native');
  });

  it('refuses a topic with no files rather than writing an empty bundle', async () => {
    await expect(exportTopic(await twoTopicWorkspace(), 'missing-topic')).rejects.toThrow(
      /no files/iu,
    );
  });

  it('resolves the slug the same way topic paths do, so traversal cannot escape', async () => {
    await expect(
      exportTopic(await twoTopicWorkspace(), '../../cloud-native'),
    ).resolves.toBeTruthy();
  });

  it('does not include a topic whose name merely starts with the same slug', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    await createTopic(storage, 'Cloud', now);
    await createTopic(storage, 'Cloud native', now);

    const paths = await pathsIn(await exportTopic(storage, 'cloud'));

    expect(paths.some((path) => path.startsWith('Topics/cloud-native/'))).toBe(false);
    expect(paths.some((path) => path.startsWith('Topics/cloud/'))).toBe(true);
  });
});

describe('workspace archive resource limits', () => {
  it('rejects a single expanded file before allocating it as imported text', async () => {
    const zip = new JSZip();
    zip.file('oversized.md', 'x'.repeat(9 * 1024 * 1024));
    const archive = await zip.generateAsync({ compression: 'DEFLATE', type: 'uint8array' });

    await expect(prepareWorkspaceImport(archive)).rejects.toThrow(/8 MiB per-file limit/u);
  });

  it('rejects a suspicious compression ratio before expanding archive entries', async () => {
    const zip = new JSZip();
    zip.file('repeated.md', 'repeated line\n'.repeat(160_000));
    const archive = await zip.generateAsync({ compression: 'DEFLATE', type: 'uint8array' });

    await expect(prepareWorkspaceImport(archive)).rejects.toThrow(/unsafe compression ratio/u);
  });

  it('rejects excessive file count and path depth before workspace validation', async () => {
    const many = new JSZip();
    for (let index = 0; index < 5_001; index += 1) many.file(`files/${index}.md`, 'x');
    await expect(
      prepareWorkspaceImport(await many.generateAsync({ type: 'uint8array' })),
    ).rejects.toThrow(/more than 5,000 files/u);

    const deep = new JSZip();
    deep.file(`${'segment/'.repeat(17)}file.md`, 'x');
    await expect(
      prepareWorkspaceImport(await deep.generateAsync({ type: 'uint8array' })),
    ).rejects.toThrow(/excessively deep or long path/u);
  });
});
