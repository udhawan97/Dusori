import { describe, expect, it } from 'vitest';

import { SourceManifestSchema } from '../schemas/workspace.js';
import { readSourceManifest, addSource } from '../sources/import.js';
import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace } from '../workspace/create.js';
import { extractClaims, readSourcesIntoClaims } from './claims.js';

const now = new Date('2026-08-02T10:00:00.000Z');
const at = now.toISOString();
const slug = 'spaced-repetition-learning';

const article = `# Spaced repetition

## Forgetting curve

Spaced repetition is a learning technique that schedules reviews at increasing intervals to
counter the forgetting curve. Short.

## Evidence

A 2006 review found that distributed practice produces markedly better long-term retention
than massed practice across a wide range of materials.

See also the list of related articles.
`;

async function topicStorage(): Promise<MemoryStorageAdapter> {
  const storage = new MemoryStorageAdapter();
  await createWorkspace(storage, 'Dusori', now);
  await createTopic(storage, 'Spaced repetition learning', now);
  return storage;
}

describe('claim extraction', () => {
  it('quotes source sentences verbatim under their own headings', () => {
    const claims = extractClaims({ at, content: article, title: 'Spaced repetition' });

    expect(claims).toHaveLength(2);
    expect(claims[0]).toEqual({
      at,
      heading: 'Forgetting curve',
      text: 'Spaced repetition is a learning technique that schedules reviews at increasing intervals to counter the forgetting curve.',
    });
    expect(claims[1]?.heading).toBe('Evidence');
    expect(article).toContain('distributed practice produces markedly better long-term retention');
  });

  it('drops navigation lines and sentences too short to carry a claim', () => {
    const claims = extractClaims({ at, content: article, title: 'Spaced repetition' });

    expect(claims.some((claim) => claim.text === 'Short.')).toBe(false);
    expect(claims.some((claim) => claim.text.startsWith('See also'))).toBe(false);
  });

  it('returns nothing for a stored URL reference that was never fetched', () => {
    const reference =
      '# Some page\n\nOriginal URL: <https://example.com/page>\n\nDusori stored this reference without fetching its contents.\n';

    expect(extractClaims({ at, content: reference, title: 'Some page' })).toEqual([]);
  });

  it('honours the per-source limit', () => {
    const many = Array.from(
      { length: 20 },
      (_unused, index) =>
        `Item ${index} is a sentence long enough to be treated as a genuine claim by the extractor.`,
    ).join(' ');

    expect(extractClaims({ at, content: `# T\n\n${many}`, limit: 3, title: 'T' })).toHaveLength(3);
  });
});

describe('reading sources into claims', () => {
  it('records claims and read state on the manifest, and is idempotent', async () => {
    const storage = await topicStorage();
    await addSource(storage, {
      content: article,
      method: 'url',
      origin: { capturedAt: at, capturedVia: 'api-extract', provider: 'wikipedia' },
      title: 'Spaced repetition',
      topicSlug: slug,
      url: 'https://en.wikipedia.org/wiki/Spaced_repetition',
    });

    const first = await readSourcesIntoClaims(storage, slug, now);
    expect(first.read).toEqual([
      expect.objectContaining({ claims: 2, title: 'Spaced repetition' }),
    ]);

    const manifest = await readSourceManifest(storage, slug, now);
    expect(manifest.sources[0]?.readState).toBe('read');
    expect(manifest.sources[0]?.claims).toHaveLength(2);

    const before = await storage.read(`Topics/${slug}/Sources/manifest.json`);
    await readSourcesIntoClaims(storage, slug, now);
    const after = await storage.read(`Topics/${slug}/Sources/manifest.json`);
    expect(after?.hash).toBe(before?.hash);
  });

  it('reports a bare reference as unreadable rather than silently skipping it', async () => {
    const storage = await topicStorage();
    await addSource(storage, {
      method: 'url',
      title: 'Unfetched page',
      topicSlug: slug,
      url: 'https://example.com/page',
    });

    const result = await readSourcesIntoClaims(storage, slug, now);

    expect(result.read).toEqual([]);
    expect(result.unreadable).toEqual([
      {
        reason: 'Only a reference is stored. Run the companion to fetch the page text.',
        title: 'Unfetched page',
      },
    ]);
    const manifest = await readSourceManifest(storage, slug, now);
    expect(manifest.sources[0]?.readState).toBe('readable');
  });

  it('never extracts claims from an explicit reference and clears legacy reference claims', async () => {
    const storage = await topicStorage();
    await addSource(storage, {
      content:
        '# Search result\n\nA provider snippet reports that this sentence is long enough to look like evidence, but it is only metadata.\n',
      method: 'url',
      provenance: { readState: 'reference' },
      title: 'Search result only',
      topicSlug: slug,
      url: 'https://example.com/reference',
    });
    const path = `Topics/${slug}/Sources/manifest.json`;
    const snapshot = await storage.read(path);
    const manifest = SourceManifestSchema.parse(JSON.parse(snapshot!.content));
    manifest.sources[0]!.claims = [
      { at, text: 'A legacy claim that must be removed because the source is a reference.' },
    ];
    await storage.write(path, `${JSON.stringify(manifest, null, 2)}\n`, {
      expectedHash: snapshot!.hash,
    });

    const result = await readSourcesIntoClaims(storage, slug, now);
    expect(result.read).toEqual([]);
    expect(result.unreadable[0]?.reason).toContain('Only a reference is stored');
    expect((await readSourceManifest(storage, slug, now)).sources[0]?.claims).toBeUndefined();
  });
});
