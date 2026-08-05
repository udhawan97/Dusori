import { describe, expect, it } from 'vitest';

import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace } from '../workspace/create.js';
import { runResearchAgent } from './agent.js';
import { buildResearchQuery } from './plan.js';
import { readResearchFile } from './research-file.js';
import type { ResearchCandidate, ResearchProvider } from './types.js';

const now = new Date('2026-07-21T10:00:00.000Z');
const query = buildResearchQuery('TypeScript', { title: 'Understand generics' });

function candidate(overrides: Partial<ResearchCandidate> = {}): ResearchCandidate {
  return {
    key: 'test:1',
    meta: {},
    provider: 'test',
    score: 1,
    snippet: 'Generics explained for TypeScript developers.',
    title: 'TypeScript generics',
    url: 'https://example.com/1',
    ...overrides,
  };
}

function stubProvider(
  id: string,
  candidates: ResearchCandidate[],
  behavior: { fails?: string; stalls?: boolean } = {},
): ResearchProvider {
  return {
    capturedVia: () => 'search-reference',
    describeMeta: () => '',
    disclosure: `${id} disclosure`,
    id,
    label: id,
    origins: [],
    async capture(target) {
      return { content: `# ${target.title}\n`, title: target.title, url: target.url };
    },
    async search() {
      if (behavior.fails) throw new Error(behavior.fails);
      if (behavior.stalls) await new Promise(() => undefined);
      return candidates;
    },
  };
}

async function workspace(): Promise<{ storage: MemoryStorageAdapter; topicSlug: string }> {
  const storage = new MemoryStorageAdapter();
  await createWorkspace(storage, 'Dusori', now);
  const topic = await createTopic(storage, 'TypeScript', now);
  return { storage, topicSlug: topic.topicSlug };
}

describe('runResearchAgent', () => {
  it('merges every provider into one ranked shortlist', async () => {
    const { storage, topicSlug } = await workspace();

    const result = await runResearchAgent({
      now,
      providers: [
        stubProvider('alpha', [candidate({ key: 'alpha:1', url: 'https://example.com/a' })]),
        stubProvider('beta', [candidate({ key: 'beta:1', url: 'https://example.com/b' })]),
      ],
      query,
      storage,
      topicSlug,
    });

    expect(result.shortlist).toHaveLength(2);
    expect(result.skipped).toEqual([]);
    expect(result.shortlist.map((item) => item.key).sort()).toEqual(['alpha:1', 'beta:1']);
  });

  it('keeps the results a failing provider did not cost, and names the one that failed', async () => {
    const { storage, topicSlug } = await workspace();

    const result = await runResearchAgent({
      now,
      providers: [
        stubProvider('alpha', [candidate({ key: 'alpha:1', url: 'https://example.com/a' })]),
        stubProvider('beta', [], { fails: 'Beta search could not be reached.' }),
      ],
      query,
      storage,
      topicSlug,
    });

    expect(result.shortlist).toHaveLength(1);
    expect(result.skipped).toEqual([
      { id: 'beta', label: 'beta', message: 'Beta search could not be reached.' },
    ]);
  });

  it('skips a provider that stalls instead of hanging the run', async () => {
    const { storage, topicSlug } = await workspace();

    const result = await runResearchAgent({
      now,
      providers: [
        stubProvider('alpha', [candidate({ key: 'alpha:1', url: 'https://example.com/a' })]),
        stubProvider('slow', [], { stalls: true }),
      ],
      query,
      storage,
      timeoutMs: 10,
      topicSlug,
    });

    expect(result.shortlist).toHaveLength(1);
    expect(result.skipped[0]?.id).toBe('slow');
    expect(result.skipped[0]?.message).toMatch(/too long/u);
  });

  it('records the run so the next one can tell what is new', async () => {
    const { storage, topicSlug } = await workspace();
    const providers = [
      stubProvider('alpha', [candidate({ key: 'alpha:1', url: 'https://example.com/a' })]),
    ];

    const first = await runResearchAgent({ now, providers, query, storage, topicSlug });
    expect(first.shortlist[0]?.isNew).toBe(false);

    const later = new Date('2026-07-22T10:00:00.000Z');
    const second = await runResearchAgent({
      now: later,
      providers: [
        stubProvider('alpha', [
          candidate({ key: 'alpha:1', url: 'https://example.com/a' }),
          candidate({ key: 'alpha:2', url: 'https://example.com/new' }),
        ]),
      ],
      query,
      storage,
      topicSlug,
    });

    const byKey = new Map(second.shortlist.map((item) => [item.key, item]));
    expect(byKey.get('alpha:1')?.isNew).toBe(false);
    expect(byKey.get('alpha:2')?.isNew).toBe(true);

    const file = await readResearchFile(storage, topicSlug, later);
    expect(file?.lastRunAt).toBe(later.toISOString());
    expect(file?.seen?.map((item) => item.key).sort()).toEqual(['alpha:1', 'alpha:2']);
  });

  it('holds the default shortlist to eight and puts the rest in overflow', async () => {
    const { storage, topicSlug } = await workspace();
    const many = Array.from({ length: 9 }, (_item, index) =>
      candidate({
        key: `alpha:${index}`,
        score: 9 - index,
        url: `https://example.com/${index}`,
      }),
    );

    const result = await runResearchAgent({
      now,
      providers: [stubProvider('alpha', many)],
      query,
      storage,
      topicSlug,
    });

    expect(result.shortlist).toHaveLength(8);
    expect(result.overflow).toHaveLength(1);
  });

  it('keeps only the strongest copy when providers return the same canonical URL', async () => {
    const { storage, topicSlug } = await workspace();
    const result = await runResearchAgent({
      now,
      providers: [
        stubProvider('alpha', [
          candidate({
            key: 'alpha:weak',
            snippet: 'TypeScript generics.',
            title: 'Short note',
            url: 'https://example.com/article?utm_source=alpha',
          }),
        ]),
        stubProvider('beta', [
          candidate({
            key: 'beta:strong',
            snippet: 'Understand generics deeply in TypeScript.',
            title: 'TypeScript generics guide',
            url: 'https://example.com/article',
          }),
        ]),
      ],
      query,
      storage,
      topicSlug,
    });

    expect(result.shortlist.map((item) => item.key)).toEqual(['beta:strong']);
    expect((await readResearchFile(storage, topicSlug, now))?.seen).toHaveLength(1);
  });

  // A failed run is evidence too. Writing nothing used to make "the providers broke" and
  // "the providers found nothing" indistinguishable the moment the page reloaded.
  it('records the failure when every provider was skipped, saving no candidates', async () => {
    const { storage, topicSlug } = await workspace();

    const result = await runResearchAgent({
      now,
      providers: [stubProvider('alpha', [], { fails: 'no network' })],
      query,
      storage,
      topicSlug,
    });

    expect(result.shortlist).toEqual([]);
    expect(result.run?.providers).toEqual([
      { count: 0, id: 'alpha', label: 'alpha', message: 'no network', outcome: 'failed' },
    ]);
    expect(result.run?.newKeys).toBe(0);
    const file = await readResearchFile(storage, topicSlug, now);
    expect(file?.runs).toHaveLength(1);
    expect(file?.seen ?? []).toEqual([]);
  });

  it('records per-provider outcomes for a mixed run', async () => {
    const { storage, topicSlug } = await workspace();

    const result = await runResearchAgent({
      now,
      providers: [
        stubProvider('alpha', [candidate({ key: 'alpha:1', url: 'https://example.com/1' })]),
        stubProvider('beta', []),
        stubProvider('gamma', [], { fails: 'boom' }),
      ],
      query,
      storage,
      topicSlug,
    });

    expect(result.run?.providers).toEqual([
      { count: 1, id: 'alpha', label: 'alpha', outcome: 'found' },
      { count: 0, id: 'beta', label: 'beta', outcome: 'empty' },
      { count: 0, id: 'gamma', label: 'gamma', message: 'boom', outcome: 'failed' },
    ]);
    expect(result.run?.searchText).toBe(query.searchText);
  });
});
