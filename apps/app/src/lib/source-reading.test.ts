import type { SourceRecord } from '@dusori/core';
import { describe, expect, it } from 'vitest';

import {
  buildSourceQuoteLocator,
  filterSavedSources,
  normalizeSelectedPassage,
  parseSourceAnnotationMetadata,
  resolveSourceQuoteLocator,
  sourceAnnotationTemplate,
  sourceFilterCounts,
} from './source-reading.js';

const sources: SourceRecord[] = [
  {
    fetchedAt: '2026-08-24T12:00:00.000Z',
    method: 'paste',
    path: 'Topics/print/Sources/items/one-print-culture.txt',
    publisher: 'Musée du Livre',
    sha256: 'a'.repeat(64),
    title: 'Print culture',
  },
  {
    fetchedAt: '2026-08-24T12:00:00.000Z',
    method: 'url',
    path: 'Topics/print/Sources/items/two-catalog.md',
    readState: 'reference',
    citation: {
      schemaVersion: 'dusori-citation-v1',
      identifiers: [{ scheme: 'doi', value: '10.1000/catalog.2' }],
      provenance: [{ capturedAt: '2026-08-24T12:00:00.000Z', method: 'source-url' }],
    },
    sha256: 'b'.repeat(64),
    title: 'Catalog record',
    url: 'https://catalog.example.org/item/2',
  },
];

describe('source shelf discovery', () => {
  it('filters locally by evidence state and accent-insensitive metadata', () => {
    expect(filterSavedSources(sources, 'musee', 'evidence')).toEqual([sources[0]]);
    expect(filterSavedSources(sources, 'catalog.example.org', 'references')).toEqual([sources[1]]);
    expect(filterSavedSources(sources, '10.1000/catalog.2', 'references')).toEqual([sources[1]]);
    expect(filterSavedSources(sources, '', 'references')).toEqual([sources[1]]);
  });

  it('reports counts for the three stable shelf lenses', () => {
    expect(sourceFilterCounts(sources)).toEqual({ all: 2, evidence: 1, references: 1 });
  });
});

describe('source-grounded annotations', () => {
  it('keeps a bounded local locator, original quote, source link, tags, and relation', async () => {
    const sourceContent = [
      '<!-- dusori-page:0 label:1 -->',
      'Movable type changed copying. It also changed distribution.',
    ].join('\n');
    const locator = await buildSourceQuoteLocator({
      exact: 'Movable type changed copying.',
      sourceContent,
      sourceContentHash: 'c'.repeat(64),
    });
    const note = sourceAnnotationTemplate({
      createdAt: new Date('2026-08-24T12:00:00.000Z'),
      passage: {
        heading: '  Spread  ',
        locator,
        text: 'Movable   type changed copying.',
      },
      source: sources[0]!,
      sourceContentHash: 'c'.repeat(64),
      title: 'Notes on Print culture',
      topicSlug: 'print',
    });

    expect(note).toContain('annotation: source-quote');
    expect(note).toContain(`source_content_sha256: ${'c'.repeat(64)}`);
    expect(note).toContain('source_heading: "Spread"');
    expect(note).toContain('tags: [research/annotation]');
    expect(note).toContain('type: follow-up-to');
    expect(note).toContain('target: "../Sources/items/one-print-culture.txt"');
    expect(note).toContain('"normalizationVersion":"dusori-source-text-v1"');
    expect(note).toContain('"exact":"Movable type changed copying."');
    expect(note).toContain('"pageIndex":0');
    expect(note).toContain('"pageLabel":"1"');
    expect(note).toContain('[[../Sources/items/one-print-culture|Print culture]]');
    expect(note).toContain('> Movable type changed copying.');
    expect(parseSourceAnnotationMetadata(note)).toMatchObject({
      locator: { exact: 'Movable type changed copying.', pageIndex: 0 },
      sourceContentHash: 'c'.repeat(64),
      sourcePath: sources[0]!.path,
    });
  });

  it('resolves position first, falls back to bounded context, and fails closed after drift', async () => {
    const sourceContent = 'Alpha context. Exact quote. Omega context.';
    const sourceContentHash = 'd'.repeat(64);
    const locator = await buildSourceQuoteLocator({
      exact: 'Exact quote.',
      sourceContent,
      sourceContentHash,
    });

    expect(
      await resolveSourceQuoteLocator({
        locator,
        recordedSourceContentHash: sourceContentHash,
        sourceContent,
        sourceContentHash,
      }),
    ).toMatchObject({ method: 'position', status: 'anchored' });
    expect(
      await resolveSourceQuoteLocator({
        locator: { ...locator, start: 0, end: 12 },
        recordedSourceContentHash: sourceContentHash,
        sourceContent,
        sourceContentHash,
      }),
    ).toMatchObject({ method: 'context', status: 'anchored' });
    expect(
      await resolveSourceQuoteLocator({
        locator,
        recordedSourceContentHash: sourceContentHash,
        sourceContent: `${sourceContent} Edited.`,
        sourceContentHash: 'e'.repeat(64),
      }),
    ).toEqual({ status: 'stale' });
  });

  it('uses normalized Unicode for positions while retaining the selected quote spelling', async () => {
    const sourceContent = 'A Cafe\u0301 example keeps its local spelling.';
    const sourceContentHash = 'f'.repeat(64);
    const selected = 'Cafe\u0301 example';
    const locator = await buildSourceQuoteLocator({
      exact: selected,
      sourceContent,
      sourceContentHash,
    });
    const note = sourceAnnotationTemplate({
      createdAt: new Date('2026-08-24T12:00:00.000Z'),
      passage: { locator, text: selected },
      source: sources[0]!,
      sourceContentHash,
      title: 'Unicode annotation',
      topicSlug: 'print',
    });

    expect(locator).toMatchObject({ exact: 'Café example', start: 2 });
    expect(note).toContain(`> ${selected}`);
    expect(
      await resolveSourceQuoteLocator({
        locator,
        recordedSourceContentHash: sourceContentHash,
        sourceContent,
        sourceContentHash,
      }),
    ).toMatchObject({ method: 'position', start: 2, status: 'anchored' });
  });

  it('normalizes selected text without silently shortening it', () => {
    expect(normalizeSelectedPassage('  one  \n\n\n two\twords ')).toBe('one\n\ntwo words');
    expect(() =>
      sourceAnnotationTemplate({
        createdAt: new Date('2026-08-24T12:00:00.000Z'),
        passage: { text: 'x'.repeat(1201) },
        source: sources[0]!,
        sourceContentHash: 'c'.repeat(64),
        title: 'Notes on Print culture',
        topicSlug: 'print',
      }),
    ).toThrow(/at most 1,200 characters/u);
  });
});
