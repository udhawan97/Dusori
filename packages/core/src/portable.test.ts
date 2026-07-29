import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { exportTopic } from './portable.js';
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
