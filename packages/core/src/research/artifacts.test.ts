import { describe, expect, it } from 'vitest';

import { addSource } from '../sources/import.js';
import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace } from '../workspace/create.js';
import { writeLearnPage, writeTopicSynthesis } from './artifacts.js';
import { readSourcesIntoClaims } from './claims.js';
import { setResearchOutputStyle } from './research-file.js';

const now = new Date('2026-08-02T10:00:00.000Z');
const slug = 'spaced-repetition-learning';
const title = 'Spaced repetition learning';

const article = `# Spaced repetition

## Forgetting curve

Spaced repetition is a learning technique that schedules reviews at increasing intervals to
counter the forgetting curve.
`;

async function readTopic(): Promise<MemoryStorageAdapter> {
  const storage = new MemoryStorageAdapter();
  await createWorkspace(storage, 'Dusori', now);
  await createTopic(storage, title, now);
  await addSource(storage, {
    content: article,
    method: 'url',
    origin: { capturedAt: now.toISOString(), capturedVia: 'api-extract', provider: 'wikipedia' },
    title: 'Spaced repetition',
    topicSlug: slug,
    url: 'https://en.wikipedia.org/wiki/Spaced_repetition',
  });
  await readSourcesIntoClaims(storage, slug, now);
  return storage;
}

describe('topic synthesis artifact', () => {
  it('creates a tracked Synthesis.md citing the source', async () => {
    const storage = await readTopic();

    const result = await writeTopicSynthesis(storage, slug, title, now);

    expect(result.status).toBe('written');
    const file = await storage.read(`Topics/${slug}/Synthesis.md`);
    expect(file?.content).toContain('generated: synthesis');
    expect(file?.content).toContain('Spaced repetition is a learning technique');
    const state = JSON.parse((await storage.read(`Topics/${slug}/state.json`))!.content);
    expect(state.fileIndex[`Topics/${slug}/Synthesis.md`]).toBeDefined();
  });

  it('rebuilds in place when the learner has not edited it', async () => {
    const storage = await readTopic();
    await writeTopicSynthesis(storage, slug, title, now);

    const again = await writeTopicSynthesis(storage, slug, title, now);

    expect(again.status).toBe('written');
    expect(await storage.read(`Topics/${slug}/Synthesis.md`)).not.toBeNull();
  });

  it('uses the output structure stored for the topic', async () => {
    const storage = await readTopic();
    await setResearchOutputStyle(storage, slug, 'study-guide', now);

    await writeTopicSynthesis(storage, slug, title, now);

    const file = await storage.read(`Topics/${slug}/Synthesis.md`);
    expect(file?.content).toContain('structure: study-guide');
    expect(file?.content).toContain('## Key ideas');
  });

  it('never overwrites a synthesis the learner edited, proposing instead', async () => {
    const storage = await readTopic();
    await writeTopicSynthesis(storage, slug, title, now);
    await storage.externalWrite(`Topics/${slug}/Synthesis.md`, '# My own notes\n\nMine.\n');

    const result = await writeTopicSynthesis(storage, slug, title, now);

    expect(result.status).toBe('conflict');
    const kept = await storage.read(`Topics/${slug}/Synthesis.md`);
    expect(kept?.content).toBe('# My own notes\n\nMine.\n');
    if (result.status === 'conflict') {
      const proposed = await storage.read(result.conflict.proposalPath);
      expect(proposed?.content).toContain('generated: synthesis');
    }
  });
});

describe('learn page artifact', () => {
  it('writes a self-contained page into the topic Learning folder', async () => {
    const storage = await readTopic();

    const result = await writeLearnPage(storage, slug, title, now);

    expect(result.status).toBe('written');
    const file = await storage.read(`Topics/${slug}/Learning/learn.html`);
    expect(file?.content.startsWith('<!doctype html>')).toBe(true);
    expect(file?.content).toContain('Spaced repetition is a learning technique');
    const state = JSON.parse((await storage.read(`Topics/${slug}/state.json`))!.content);
    expect(state.fileIndex[`Topics/${slug}/Learning/learn.html`]).toBeDefined();
  });

  it('keeps an externally edited page and writes the rebuild beside it', async () => {
    const storage = await readTopic();
    await writeLearnPage(storage, slug, title, now);
    await storage.externalWrite(`Topics/${slug}/Learning/learn.html`, '<p>mine</p>');

    const result = await writeLearnPage(storage, slug, title, now);

    expect(result.status).toBe('proposed');
    expect((await storage.read(`Topics/${slug}/Learning/learn.html`))?.content).toBe('<p>mine</p>');
    if (result.status === 'proposed') {
      const proposed = await storage.read(result.proposalPath);
      expect(proposed?.content).toContain('<!doctype html>');
    }
  });
});
