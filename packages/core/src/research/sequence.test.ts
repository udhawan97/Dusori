import { describe, expect, it } from 'vitest';

import type { FileSnapshot, WriteOptions } from '../adapters.js';
import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace } from '../workspace/create.js';
import { readSourceManifest } from '../sources/import.js';
import { buildResearchQuery } from './plan.js';
import { runResearchSequence } from './sequence.js';
import type { ResearchCandidate, ResearchProvider } from './types.js';

const now = new Date('2026-08-11T10:00:00.000Z');
const query = buildResearchQuery('TypeScript', { title: 'Why do generic constraints matter?' });

function provider(
  options: {
    id?: string;
    reference?: boolean;
    captureFails?: boolean;
    capturePolicy?: ResearchProvider['capturePolicy'];
  } = {},
): ResearchProvider {
  const id = options.id ?? 'docs';
  const result: ResearchCandidate = {
    key: `${id}:generics`,
    kind: 'docs',
    meta: {},
    provider: id,
    score: 10,
    snippet: 'Generic constraints preserve useful relationships between values.',
    title: `${id} generic constraints`,
    url: `https://${id}.example/generics`,
  };
  return {
    capturePolicy: options.capturePolicy,
    capturedVia: () => (options.reference ? 'search-reference' : 'api-extract'),
    describeMeta: () => '',
    disclosure: 'Sends this question to the example provider.',
    id,
    label: id,
    origins: [],
    async capture() {
      if (options.captureFails) throw new Error('Capture failed safely.');
      return {
        content: options.reference
          ? `# Generic constraints\n\nOriginal URL: <${result.url}>`
          : '# Generic constraints\n\nA generic constraint is useful because it preserves relationships between input and output types while allowing callers to retain specific type information.',
        title: result.title,
        url: result.url,
      };
    },
    async search() {
      return [result];
    },
  };
}

class FailFirstSourceWriteStorage extends MemoryStorageAdapter {
  private failed = false;

  override async write(
    path: string,
    content: string,
    options: WriteOptions = {},
  ): Promise<FileSnapshot> {
    if (!this.failed && path.includes('/Sources/items/')) {
      this.failed = true;
      throw new Error('First source write failed.');
    }
    return super.write(path, content, options);
  }
}

async function workspace(
  storage = new MemoryStorageAdapter(),
): Promise<{ storage: MemoryStorageAdapter; topicSlug: string }> {
  await createWorkspace(storage, 'Dusori', now);
  const topic = await createTopic(storage, 'TypeScript', now);
  return { storage, topicSlug: topic.topicSlug };
}

describe('runResearchSequence', () => {
  it('commits a complete evidence-backed run through one interface', async () => {
    const { storage, topicSlug } = await workspace();
    const stages: string[] = [];

    const result = await runResearchSequence({
      now,
      onProgress: ({ stage }) => stages.push(stage),
      providers: [provider()],
      query,
      storage,
      topicSlug,
      topicTitle: 'TypeScript',
    });

    expect(result.status).toBe('brief-ready');
    expect(result.claimCount).toBeGreaterThan(0);
    expect(result.sources[0]?.status).toBe('readable');
    expect(stages).toEqual(['searching', 'evaluating', 'saving', 'saving', 'reading', 'writing']);
    expect(await storage.read(`Topics/${topicSlug}/Synthesis.md`)).not.toBeNull();
  });

  it('keeps a truthful reference and failure trail when capture fails', async () => {
    const { storage, topicSlug } = await workspace();
    const result = await runResearchSequence({
      now,
      providers: [provider({ captureFails: true })],
      query,
      storage,
      topicSlug,
      topicTitle: 'TypeScript',
    });

    expect(result.status).toBe('needs-readable-evidence');
    expect(result.sources[0]).toMatchObject({ status: 'failed' });
    const manifest = await readSourceManifest(storage, topicSlug, now);
    expect(manifest.sources[0]).toMatchObject({
      fetchMessage: 'Capture failed safely.',
      fetchState: 'failed',
      readState: 'reference',
    });
  });

  it('falls back deterministically when the optional enhancer fails', async () => {
    const { storage, topicSlug } = await workspace();
    const result = await runResearchSequence({
      enhanceSynthesis: async () => {
        throw new Error('Local model unavailable');
      },
      now,
      providers: [provider()],
      query,
      storage,
      topicSlug,
      topicTitle: 'TypeScript',
    });

    expect(result.status).toBe('brief-ready');
    expect(result.aiUnavailable).toBe(true);
    expect((await storage.read(`Topics/${topicSlug}/Synthesis.md`))?.content).toContain(
      'Every line below is quoted from saved source text.',
    );
  });

  it('keeps an edited brief and creates a proposal through the complete interface', async () => {
    const { storage, topicSlug } = await workspace();
    await runResearchSequence({
      now,
      providers: [provider()],
      query,
      storage,
      topicSlug,
      topicTitle: 'TypeScript',
    });
    const synthesisPath = `Topics/${topicSlug}/Synthesis.md`;
    await storage.externalWrite(synthesisPath, '# My own brief\n\nKeep this wording.\n');

    const result = await runResearchSequence({
      now,
      providers: [provider({ id: 'second-run' })],
      query,
      storage,
      topicSlug,
      topicTitle: 'TypeScript',
    });

    expect(result.status).toBe('brief-proposed');
    expect((await storage.read(synthesisPath))?.content).toBe(
      '# My own brief\n\nKeep this wording.\n',
    );
    expect(result.synthesis).toMatchObject({ status: 'conflict' });
  });

  it('continues the shortlist after one source write fails', async () => {
    const { storage, topicSlug } = await workspace(new FailFirstSourceWriteStorage());

    const result = await runResearchSequence({
      now,
      providers: [provider({ id: 'first' }), provider({ id: 'second' })],
      query,
      storage,
      topicSlug,
      topicTitle: 'TypeScript',
    });

    expect(result.sources.map((source) => source.status)).toEqual(['failed', 'readable']);
    expect(result.status).toBe('brief-ready');
    expect(result.claimCount).toBeGreaterThan(0);
  });

  it('enforces a reference-only catalog policy even if an adapter reports readable capture', async () => {
    const { storage, topicSlug } = await workspace();

    const result = await runResearchSequence({
      now,
      providers: [provider({ capturePolicy: 'reference-only' })],
      query,
      storage,
      topicSlug,
      topicTitle: 'TypeScript',
    });

    expect(result.status).toBe('needs-readable-evidence');
    const manifest = await readSourceManifest(storage, topicSlug, now);
    expect(manifest.sources[0]?.readState).toBe('reference');
  });

  it('does not egress when no already-consented provider is supplied', async () => {
    const { storage, topicSlug } = await workspace();
    const result = await runResearchSequence({
      now,
      providers: [],
      query,
      storage,
      topicSlug,
      topicTitle: 'TypeScript',
    });

    expect(result.status).toBe('no-results');
    expect(result.run).toBeNull();
  });
});
