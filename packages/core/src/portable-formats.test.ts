import { describe, expect, it } from 'vitest';

import {
  collectTopicDocument,
  topicToJson,
  topicToMarkdown,
  topicToText,
} from './portable-formats.js';
import { createTopic, createWorkspace } from './workspace/create.js';
import { MemoryStorageAdapter } from './testing/memory-storage.js';

const now = new Date('2026-07-20T12:00:00.000Z');

async function seed() {
  const storage = new MemoryStorageAdapter();
  await createWorkspace(storage, 'Dusori', now);
  await createTopic(storage, 'Azure Basics', now);
  await storage.write(
    'Topics/azure-basics/Notes/002-vnets.md',
    '# VNets\n\nA virtual network isolates resources.\n',
    { expectedHash: null },
  );
  const manifestPath = 'Topics/azure-basics/Sources/manifest.json';
  const currentManifest = await storage.read(manifestPath);
  await storage.write(
    manifestPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        sources: [
          {
            fetchedAt: now.toISOString(),
            method: 'url',
            sha256: 'a'.repeat(64),
            title: 'Azure networking docs',
            url: 'https://learn.microsoft.com/azure/networking',
          },
        ],
      },
      null,
      2,
    )}\n`,
    { expectedHash: currentManifest?.hash ?? null },
  );
  return storage;
}

describe('collectTopicDocument', () => {
  it('gathers title, status, note sections and sources', async () => {
    const storage = await seed();

    const doc = await collectTopicDocument(storage, 'azure-basics');

    expect(doc.title).toBe('Azure Basics');
    expect(doc.status).toBe('active');
    expect(doc.sections.some((section) => section.markdown.includes('A virtual network'))).toBe(
      true,
    );
    expect(doc.sources).toEqual([
      { title: 'Azure networking docs', url: 'https://learn.microsoft.com/azure/networking' },
    ]);
  });

  it('throws for an unknown topic', async () => {
    const storage = await seed();
    await expect(collectTopicDocument(storage, 'ghost')).rejects.toThrow(/no topic/iu);
  });
});

describe('topic format renderers', () => {
  it('markdown carries the title heading and note content', async () => {
    const doc = await collectTopicDocument(await seed(), 'azure-basics');
    const markdown = topicToMarkdown(doc);

    expect(markdown).toMatch(/^# Azure Basics/u);
    expect(markdown).toContain('A virtual network isolates resources.');
    expect(markdown).toContain('Azure networking docs');
  });

  it('plain text drops markdown heading and link syntax', async () => {
    const doc = await collectTopicDocument(await seed(), 'azure-basics');
    const text = topicToText(doc);

    expect(text).toContain('A virtual network isolates resources.');
    expect(text).not.toContain('# VNets');
    expect(text).not.toMatch(/\]\(https/u);
  });

  it('json round-trips the structured fields', async () => {
    const doc = await collectTopicDocument(await seed(), 'azure-basics');
    const parsed = JSON.parse(topicToJson(doc));

    expect(parsed.slug).toBe('azure-basics');
    expect(parsed.title).toBe('Azure Basics');
    expect(parsed.sources[0].url).toBe('https://learn.microsoft.com/azure/networking');
    expect(Array.isArray(parsed.sections)).toBe(true);
  });
});
