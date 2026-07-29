import { describe, expect, it } from 'vitest';

import {
  applyAiRecallPrompts,
  buildRecallAnswerNote,
  buildRecallSession,
  maxRecallExcerptCharacters,
  maxRecallPromptCharacters,
  recallAiRequest,
  recallAnswerNoteTitle,
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

  it('builds prompts from a single readable source, opening and closing the same way', async () => {
    const storage = await topicStorage();
    const path = await addMarkdownSource(storage, 'Tokenization basics', tokenizationNotes);

    const session = await readySession(storage);

    expect(session.prompts.map((prompt) => prompt.id)).toEqual([
      'explain',
      'cloze',
      'contribution-1',
      'compare',
    ]);
    expect(session.prompts[0]?.prompt).toBe(
      'Explain “Describe how attention builds a token representation” in your own words before revealing the source.',
    );
    expect(session.prompts.at(-1)?.prompt).toBe(
      'Compare your explanation with this excerpt. What did you omit or misunderstand?',
    );
    for (const prompt of session.prompts) {
      expect(prompt.generatedBy).toBe('template');
      expect(prompt.evidence.path).toBe(path);
      expect(prompt.evidence.title).toBe('Tokenization basics');
      expect(prompt.evidence.excerpt).toContain('Byte pair encoding merges');
    }
  });

  it('never leaves the three-to-five range however many sources exist', async () => {
    const single = await topicStorage();
    await addMarkdownSource(single, 'Tokenization basics', tokenizationNotes);
    const many = await topicStorage();
    await addMarkdownSource(many, 'Transformer notes', transformerNotes);
    await addMarkdownSource(many, 'Tokenization basics', tokenizationNotes);

    const fewest = await readySession(single);
    const most = await readySession(many);

    expect(fewest.prompts.length).toBeGreaterThanOrEqual(3);
    expect(fewest.prompts.length).toBeLessThanOrEqual(5);
    expect(most.prompts).toHaveLength(5);
  });

  it('asks a locate prompt once a second source exists, naming a different source', async () => {
    const storage = await topicStorage();
    await addMarkdownSource(storage, 'Transformer notes', transformerNotes);
    await addMarkdownSource(storage, 'Tokenization basics', tokenizationNotes);

    const session = await readySession(storage);
    const locate = session.prompts.find((prompt) => prompt.kind === 'locate');

    expect(locate).toBeTruthy();
    expect(locate?.prompt).toContain('which of your sources');
    expect(locate?.evidence.title).not.toBe(session.prompts[0]?.evidence.title);
  });

  it('blanks the longest word of a source sentence for the cloze prompt', async () => {
    const storage = await topicStorage();
    await addMarkdownSource(storage, 'Tokenization basics', tokenizationNotes);

    const session = await readySession(storage);
    const cloze = session.prompts.find((prompt) => prompt.kind === 'cloze');

    expect(cloze?.prompt).toContain('_____');
    expect(cloze?.prompt).toContain('Tokenization basics');
    // The blank hides a word the excerpt itself still shows on demand, so nothing is invented.
    expect(cloze?.evidence.excerpt).toContain('Byte pair encoding merges');
  });

  it('keeps the deterministic order: explain first, compare last', async () => {
    const storage = await topicStorage();
    await addMarkdownSource(storage, 'Transformer notes', transformerNotes);
    await addMarkdownSource(storage, 'Tokenization basics', tokenizationNotes);

    const session = await readySession(storage);

    expect(session.prompts[0]?.kind).toBe('explain');
    expect(session.prompts.at(-1)?.kind).toBe('compare');
    expect(new Set(session.prompts.map((prompt) => prompt.id)).size).toBe(session.prompts.length);
  });

  it('gives every prompt a source title, section, and workspace path', async () => {
    const storage = await topicStorage();
    await addMarkdownSource(storage, 'Transformer notes', transformerNotes);
    await addMarkdownSource(storage, 'Tokenization basics', tokenizationNotes);

    const session = await readySession(storage);

    for (const prompt of session.prompts) {
      expect(prompt.evidence.title).toBeTruthy();
      expect(prompt.evidence.heading).toBeTruthy();
      expect(prompt.evidence.path).toMatch(/^Topics\//u);
    }
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
    const rewritten = base.prompts.map((_prompt, index) => `  Rewritten  ${index + 1}  `);

    const applied = applyAiRecallPrompts(base, rewritten, 'llama3.2');

    expect(applied.model).toBe('llama3.2');
    expect(applied.prompts.map((prompt) => prompt.prompt)).toEqual(
      base.prompts.map((_prompt, index) => `Rewritten ${index + 1}`),
    );
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
    // Counts are derived from the session, so these stay wrong however many prompts it builds.
    const exact = base.prompts.map((_prompt, index) => `text ${index + 1}`);
    const tooFew = exact.slice(0, -1);
    const tooMany = [...exact, 'one too many'];

    expect(applyAiRecallPrompts(base, tooFew, 'llama3.2')).toBe(base);
    expect(applyAiRecallPrompts(base, tooMany, 'llama3.2')).toBe(base);
    expect(applyAiRecallPrompts(base, [...exact.slice(0, -1), '   '], 'llama3.2')).toBe(base);
    expect(applyAiRecallPrompts(base, [...exact.slice(0, -1), tooLong], 'llama3.2')).toBe(base);
    expect(applyAiRecallPrompts(base, [], 'llama3.2')).toBe(base);
  });
});

describe('buildRecallAnswerNote', () => {
  async function session(): Promise<RecallSession> {
    const storage = await topicStorage();
    await addMarkdownSource(storage, 'Transformer notes', transformerNotes);
    return readySession(storage);
  }

  it('keeps the learner’s words and marks the prompts as generated', async () => {
    const base = await session();
    const note = buildRecallAnswerNote(
      base,
      { compare: '   ', explain: 'Attention mixes tokens.\n\nI missed the weighting.' },
      now,
    );

    expect(note).toContain(`title: ${JSON.stringify(recallAnswerNoteTitle(base, now))}`);
    expect(note).toContain('topic: ai-fundamentals');
    expect(note).toContain('created: 2026-07-27');
    // The answers are the learner's writing, so the note is never marked generated as a whole.
    expect(note).not.toContain('generated:');
    expect(note).toContain('The prompts below were generated by Dusori');
    expect(note).toContain('Attention mixes tokens.\n\nI missed the weighting.');
    expect(note).toContain('> Explain “Describe how attention builds a token representation”');
    expect(note).toContain('Deterministic prompt');
    expect(note).toContain('Transformer notes');
    expect(note).toContain('Topics/ai-fundamentals/Sources/items/');
    // A prompt left blank is simply absent rather than recorded as an empty answer.
    expect(note).not.toContain('Compare your explanation');
  });

  it('names the model that wrote a prompt', async () => {
    const deterministic = await session();
    const base = applyAiRecallPrompts(
      deterministic,
      deterministic.prompts.map((_, position) => `Rewritten prompt ${position + 1}`),
      'gemma3:4b',
    );

    expect(buildRecallAnswerNote(base, { explain: 'My answer.' }, now)).toContain(
      'Prompt written by gemma3:4b',
    );
  });

  it('refuses to write a note with nothing in it', async () => {
    const base = await session();
    expect(() => buildRecallAnswerNote(base, {}, now)).toThrow(/answer/u);
    expect(() => buildRecallAnswerNote(base, { explain: '\n  \t ' }, now)).toThrow(/answer/u);
  });
});
