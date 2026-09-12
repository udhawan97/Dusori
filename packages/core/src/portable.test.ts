import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';

import { exportTopic, exportWorkspace, prepareWorkspaceImport } from './portable.js';
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
  it('exports an importable workspace while retaining internal recovery copies on disk', async () => {
    const storage = await twoTopicWorkspace();
    for (const root of ['.dusori-import-recovery', '.dusori-recovery']) {
      await storage.write(`${root}/original.json`, 'preserved recovery bytes');
    }
    const archive = await exportWorkspace(storage);
    await expect(prepareWorkspaceImport(archive)).resolves.toMatchObject({
      preview: { workspaceName: 'Dusori' },
    });
    expect((await pathsIn(archive)).some((path) => path.startsWith('.dusori'))).toBe(false);
    for (const root of ['.dusori-import-recovery', '.dusori-recovery']) {
      expect((await storage.read(`${root}/original.json`))?.content).toBe(
        'preserved recovery bytes',
      );
    }
  });

  it('rejects a later invalid path before expanding any entry', async () => {
    const archive = await exportWorkspace(await twoTopicWorkspace());
    const zip = await JSZip.loadAsync(archive);
    // Use a real parsed entry so central-directory size validation still executes.
    const last = Object.values(zip.files).find((entry) => !entry.dir)!;
    const entries = Object.values(zip.files).filter((entry) => !entry.dir);
    const spies = entries.map((entry) => vi.spyOn(entry, 'async'));
    const invalid = {
      ...last,
      name: '.dusori-import-recovery/invalid.md',
      unsafeOriginalName: '.dusori-import-recovery/invalid.md',
    };
    zip.files['.dusori-import-recovery/invalid.md'] = invalid;
    const loader = vi.spyOn(JSZip, 'loadAsync').mockResolvedValueOnce(zip);
    try {
      await expect(prepareWorkspaceImport(archive)).rejects.toThrow(/reserved recovery path/u);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      loader.mockRestore();
    }
  });

  it.each([
    {
      files: [['Home.MD', 'alias']],
      message: /aliased paths/u,
      name: 'case-folded aliases',
    },
    {
      files: [
        ['Topics/cloud-native/Notes/Café.md', 'first'],
        ['Topics/cloud-native/Notes/Cafe\u0301.md', 'second'],
      ],
      message: /aliased paths/u,
      name: 'Unicode-normalized aliases',
    },
    {
      files: [
        ['collision', 'file'],
        ['collision/child.md', 'child'],
      ],
      message: /file as a directory/u,
      name: 'file and directory ancestor collisions',
    },
    {
      files: [['Topics/cloud-native/Notes/trailing.', 'alias']],
      message: /non-portable path/u,
      name: 'trailing-dot aliases',
    },
    {
      files: [['.DUSORI-IMPORT-RECOVERY/backup/dusori.json', '{}']],
      message: /reserved recovery path/u,
      name: 'internal recovery paths',
    },
    {
      files: [['.dusori-recovery/original.json', '{}']],
      message: /reserved recovery path/u,
      name: 'machine-file recovery paths',
    },
    {
      files: [['Topics/cloud-native/Notes/trailing ', 'alias']],
      message: /non-portable path/u,
      name: 'trailing-space aliases',
    },
    {
      files: [['Home.md/child.md', 'child']],
      message: /file as a directory/u,
      name: 'existing file ancestors',
    },
  ])('rejects $name before workspace validation', async ({ files, message }) => {
    const zip = await JSZip.loadAsync(await exportWorkspace(await twoTopicWorkspace()));
    for (const [path, content] of files) zip.file(path!, content!);

    await expect(
      prepareWorkspaceImport(await zip.generateAsync({ type: 'uint8array' })),
    ).rejects.toThrow(message);
  });

  it('rejects an invalid additive research activity file during archive preflight', async () => {
    const storage = await twoTopicWorkspace();
    await storage.write(
      'Topics/cloud-native/research.json',
      '{"schemaVersion":1,"topicSlug":"another-topic","dismissed":[]}',
      { expectedHash: null },
    );

    await expect(prepareWorkspaceImport(await exportWorkspace(storage))).rejects.toThrow(
      "The import's research activity is invalid: cloud-native",
    );
  });

  it('rejects imported research activity beyond the 256 KiB event budget', async () => {
    const storage = await twoTopicWorkspace();
    const threadId = `thread-${'a'.repeat(24)}`;
    const events = Array.from({ length: 500 }, (_item, index) => ({
      at: now.toISOString(),
      eventId: `event-${index.toString(16).padStart(24, '0')}`,
      questionText: `${index.toString().padStart(3, '0')} ${'x'.repeat(396)}`,
      threadId,
      type: 'question-created',
    }));
    expect(new TextEncoder().encode(JSON.stringify(events)).byteLength).toBeGreaterThan(256 * 1024);
    await storage.write(
      'Topics/cloud-native/research.json',
      JSON.stringify({ dismissed: [], events, schemaVersion: 1, topicSlug: 'cloud-native' }),
      { expectedHash: null },
    );

    await expect(prepareWorkspaceImport(await exportWorkspace(storage))).rejects.toThrow(
      "The import's research activity is invalid: cloud-native",
    );
  });

  it('translates a corrupt or mislabeled ZIP into product recovery guidance', async () => {
    await expect(prepareWorkspaceImport(new TextEncoder().encode('not a zip'))).rejects.toThrow(
      'This file is not a valid Dusori workspace export. Choose a .zip exported by Dusori and try again.',
    );
  });

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
