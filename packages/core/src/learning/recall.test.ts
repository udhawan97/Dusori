import { describe, expect, it } from 'vitest';

import {
  applyAiRecallPrompts,
  buildRecallSession,
  maxRecallExcerptCharacters,
  maxRecallPromptCharacters,
  recallAiRequest,
  type RecallSession,
} from './recall.js';

import { addSource } from '../sources/import.js';
import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace, workspaceFingerprint } from '../workspace/create.js';

const now = new Date('2026-07-27T09:00:00.000Z');
const topicSlug = 'ai-fundamentals';
const input = {
  objective: 'Describe how attention builds a token representation',
  topicSlug,
  topicTitle: 'AI Fundamentals',
};

const transformerNotes = `# Transformer notes

## Attention

Attention lets each token weigh every other token in its context window and keep a weighted sum
as its next representation.

## Positional encoding

Attention alone is order-free, so positional encodings put sequence position back into each
representation before the first attention block runs.
`;

const tokenizationNotes = `# Tokenization basics

Byte pair encoding merges the most frequent adjacent symbol pairs until the vocabulary reaches
its target size, so common words stay whole and rare words split into parts.
`;

async function topicStorage(): Promise<MemoryStorageAdapter> {
  const storage = new MemoryStorageAdapter();
  await createWorkspace(storage, 'Test workspace', now);
  await createTopic(storage, 'AI Fundamentals', now);
  return storage;
}

async function addMarkdownSource(
  storage: MemoryStorageAdapter,
  title: string,
  content: string,
): Promise<string> {
  const added = await addSource(
    storage,
    { content, mediaType: 'text/markdown', method: 'paste', title, topicSlug },
    now,
  );
  return added.path;
}

async function readySession(storage: MemoryStorageAdapter): Promise<RecallSession> {
  const result = await buildRecallSession(storage, input, now);
  if (result.status !== 'ready') throw new Error(`Expected a ready session, got ${result.status}.`);
  return result.session;
}

describe('buildRecallSession', () => {
  it('reports a topic with no sources instead of inventing prompts', async () => {
    const storage = await topicStorage();

    expect(await buildRecallSession(storage, input, now)).toEqual({ status: 'no-sources' });
  });

  it('reports URL references that were stored without their page text', async () => {
    const storage = await topicStorage();
    await addSource(
      storage,
      {
        method: 'url',
        title: 'Attention is all you need',
        topicSlug,
        url: 'https://example.com/a',
      },
      now,
    );
    await addSource(
      storage,
      { method: 'url', title: 'Positional encodings', topicSlug, url: 'https://example.com/b' },
      now,
    );

    expect(await buildRecallSession(storage, input, now)).toEqual({
      referenceCount: 2,
      status: 'no-readable-sources',
    });
  });

  it('builds three prompts from a single readable source', async () => {
    const storage = await topicStorage();
    const path = await addMarkdownSource(storage, 'Tokenization basics', tokenizationNotes);

    const session = await readySession(storage);

    expect(session.prompts.map((prompt) => prompt.id)).toEqual([
      'explain',
      'contribution-1',
      'compare',
    ]);
    expect(session.prompts[0]?.prompt).toBe(
      'Explain “Describe how attention builds a token representation” in your own words before revealing the source.',
    );
    expect(session.prompts[1]?.prompt).toBe(
      'What does “Tokenization basics” in Tokenization basics contribute to “Describe how attention builds a token representation”?',
    );
    expect(session.prompts[2]?.prompt).toBe(
      'Compare your explanation with this excerpt. What did you omit or misunderstand?',
    );
    for (const prompt of session.prompts) {
      expect(prompt.generatedBy).toBe('template');
      expect(prompt.evidence.path).toBe(path);
      expect(prompt.evidence.title).toBe('Tokenization basics');
      expect(prompt.evidence.excerpt).toContain('Byte pair encoding merges');
    }
  });

  it('spreads prompts across sources and stops at five', async () => {
    const storage = await topicStorage();
    await addMarkdownSource(storage, 'Transformer notes', transformerNotes);
    await addMarkdownSource(storage, 'Tokenization basics', tokenizationNotes);

    const session = await readySession(storage);
    const contributions = session.prompts.filter((prompt) => prompt.kind === 'contribution');

    expect(session.prompts).toHaveLength(5);
    // Round-robin: the second source is reached before the first source's second section.
    expect(contributions.map((prompt) => prompt.evidence.heading)).toEqual([
      'Attention',
      'Tokenization basics',
      'Positional encoding',
    ]);
    expect(contributions[0]?.evidence.title).toBe('Transformer notes');
    expect(contributions[1]?.evidence.title).toBe('Tokenization basics');
  });

  it('bounds every excerpt and cuts on a word boundary', async () => {
    const storage = await topicStorage();
    const sentence = 'Attention weighs every token against every other token in the window. ';
    await addMarkdownSource(storage, 'Long note', `# Long note\n\n${sentence.repeat(20)}`);

    const [prompt] = (await readySession(storage)).prompts;

    expect(prompt?.evidence.truncated).toBe(true);
    expect(prompt?.evidence.excerpt.length).toBeLessThanOrEqual(maxRecallExcerptCharacters);
    expect(prompt?.evidence.excerpt.endsWith('…')).toBe(true);
    expect(prompt?.evidence.excerpt).not.toMatch(/\s…$/u);
  });

  it('flattens Markdown so an excerpt reads as a quotation', async () => {
    const storage = await topicStorage();
    await addMarkdownSource(
      storage,
      'Formatted note',
      '# Formatted note\n\n> **Attention** reads [the paper](https://example.com/a) and `softmax` weights, so each token keeps a blended view of its neighbours.\n',
    );

    const [prompt] = (await readySession(storage)).prompts;

    expect(prompt?.evidence.excerpt).toBe(
      'Attention reads the paper and softmax weights, so each token keeps a blended view of its neighbours.',
    );
  });

  it('shortens a long objective inside the prompt but keeps the full objective', async () => {
    const storage = await topicStorage();
    await addMarkdownSource(storage, 'Tokenization basics', tokenizationNotes);
    const objective = `Explain ${'the identity boundary case '.repeat(20)}completely`;

    const result = await buildRecallSession(storage, { ...input, objective }, now);
    if (result.status !== 'ready') throw new Error('Expected a ready session.');

    expect(result.session.objective).toBe(objective);
    expect(result.session.prompts[0]?.prompt.length).toBeLessThan(200);
    expect(result.session.prompts[0]?.prompt).toContain('…');
  });

  it('skips a source whose file is gone instead of failing the session', async () => {
    const storage = await topicStorage();
    const missing = await addMarkdownSource(storage, 'Deleted note', transformerNotes);
    await addMarkdownSource(storage, 'Tokenization basics', tokenizationNotes);
    await storage.remove(missing);

    const session = await readySession(storage);

    expect(session.prompts.every((prompt) => prompt.evidence.title === 'Tokenization basics')).toBe(
      true,
    );
  });

  it('is deterministic and writes nothing to the workspace', async () => {
    const storage = await topicStorage();
    await addMarkdownSource(storage, 'Transformer notes', transformerNotes);
    await addMarkdownSource(storage, 'Tokenization basics', tokenizationNotes);
    const before = await workspaceFingerprint(storage);

    const first = await readySession(storage);
    const second = await readySession(storage);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(await workspaceFingerprint(storage)).toBe(before);
  });
});

describe('recallAiRequest', () => {
  it('carries the objective and bounded excerpts and nothing else', async () => {
    const storage = await topicStorage();
    await addMarkdownSource(storage, 'Transformer notes', transformerNotes);
    const session = await readySession(storage);

    const request = recallAiRequest(session);

    expect(Object.keys(request).sort()).toEqual(['excerpts', 'objective']);
    expect(request.objective).toBe(input.objective);
    expect(request.excerpts).toHaveLength(session.prompts.length);
    for (const excerpt of request.excerpts) {
      expect(Object.keys(excerpt).sort()).toEqual(['excerpt', 'heading', 'title']);
      expect(excerpt.excerpt.length).toBeLessThanOrEqual(maxRecallExcerptCharacters);
    }
    // Local paths stay on the device: nothing in the payload names the workspace.
    expect(JSON.stringify(request)).not.toContain('Topics/');
  });
});

describe('applyAiRecallPrompts', () => {
  async function session(): Promise<RecallSession> {
    const storage = await topicStorage();
    await addMarkdownSource(storage, 'Tokenization basics', tokenizationNotes);
    return readySession(storage);
  }

  it('replaces prompt text, names the model, and keeps every piece of evidence', async () => {
    const base = await session();

    const applied = applyAiRecallPrompts(
      base,
      ['  Rewritten  one  ', 'Rewritten two', 'Rewritten three'],
      'llama3.2',
    );

    expect(applied.model).toBe('llama3.2');
    expect(applied.prompts.map((prompt) => prompt.prompt)).toEqual([
      'Rewritten one',
      'Rewritten two',
      'Rewritten three',
    ]);
    expect(applied.prompts.every((prompt) => prompt.generatedBy === 'ai')).toBe(true);
    expect(applied.prompts.map((prompt) => prompt.evidence)).toEqual(
      base.prompts.map((prompt) => prompt.evidence),
    );
    expect(applied.prompts.map((prompt) => prompt.id)).toEqual(
      base.prompts.map((prompt) => prompt.id),
    );
  });

  it('keeps the deterministic prompts when the reply is malformed', async () => {
    const base = await session();
    const tooLong = 'x'.repeat(maxRecallPromptCharacters + 1);

    expect(applyAiRecallPrompts(base, ['one', 'two'], 'llama3.2')).toBe(base);
    expect(applyAiRecallPrompts(base, ['one', 'two', 'three', 'four'], 'llama3.2')).toBe(base);
    expect(applyAiRecallPrompts(base, ['one', '   ', 'three'], 'llama3.2')).toBe(base);
    expect(applyAiRecallPrompts(base, ['one', tooLong, 'three'], 'llama3.2')).toBe(base);
    expect(applyAiRecallPrompts(base, [], 'llama3.2')).toBe(base);
  });
});
