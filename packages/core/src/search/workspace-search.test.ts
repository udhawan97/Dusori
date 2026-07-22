import { describe, expect, it } from 'vitest';

import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { searchWorkspace } from './workspace-search.js';

describe('searchWorkspace', () => {
  it('finds local Markdown and text by every query term and ranks title matches first', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.write(
      'Topics/ai/Notes/attention-map.md',
      `---\ntitle: Attention map\n---\n\n# Attention map\n\nTokens use contextual weighting to share evidence.`,
    );
    await storage.write(
      'Topics/ai/Sources/items/transformers.md',
      `---\ntitle: Transformer field notes\n---\n\nContextual weighting lets each token inspect other tokens.`,
    );
    await storage.write(
      'Topics/ai/Sources/manifest.json',
      JSON.stringify({
        schemaVersion: 1,
        sources: [
          {
            fetchedAt: '2026-07-21T12:00:00.000Z',
            method: 'paste',
            path: 'Topics/ai/Sources/items/transformers.md',
            sha256: 'a'.repeat(64),
            title: 'Manifest source title',
          },
        ],
      }),
    );
    await storage.write('Topics/ai/state.json', '{"private":"contextual weighting"}');
    await storage.write('Topics/ai/Conflicts/draft.md', '# Draft\n\ncontextual weighting');

    const results = await searchWorkspace(storage, 'contextual weighting');

    expect(results.map((result) => result.path)).toEqual([
      'Topics/ai/Notes/attention-map.md',
      'Topics/ai/Sources/items/transformers.md',
    ]);
    expect(results[0]).toMatchObject({
      kind: 'note',
      title: 'Attention map',
      topicSlug: 'ai',
    });
    expect(results[0]?.snippet).toContain('contextual weighting');
    expect(results[1]?.title).toBe('Manifest source title');
  });

  it('matches case and accents without changing the stored text', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.write('home.md', '# Résumé Study\n\nA CAFÉ learning plan.');

    const results = await searchWorkspace(storage, 'resume cafe');

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ kind: 'workspace', path: 'home.md', title: 'Résumé Study' });
    expect(results[0]?.snippet).toContain('CAFÉ');
  });

  it('returns an empty result for blank queries and honors the result limit', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.write('one.md', '# One\n\nshared phrase');
    await storage.write('two.txt', 'shared phrase');

    await expect(searchWorkspace(storage, '   ')).resolves.toEqual([]);
    await expect(searchWorkspace(storage, 'shared', { limit: 1 })).resolves.toHaveLength(1);
  });
});
