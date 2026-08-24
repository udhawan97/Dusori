import type { SourceRecord } from '@dusori/core';
import { describe, expect, it } from 'vitest';

import {
  filterSavedSources,
  normalizeSelectedPassage,
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
    sha256: 'b'.repeat(64),
    title: 'Catalog record',
    url: 'https://catalog.example.org/item/2',
  },
];

describe('source shelf discovery', () => {
  it('filters locally by evidence state and accent-insensitive metadata', () => {
    expect(filterSavedSources(sources, 'musee', 'evidence')).toEqual([sources[0]]);
    expect(filterSavedSources(sources, 'catalog.example.org', 'references')).toEqual([sources[1]]);
    expect(filterSavedSources(sources, '', 'references')).toEqual([sources[1]]);
  });

  it('reports counts for the three stable shelf lenses', () => {
    expect(sourceFilterCounts(sources)).toEqual({ all: 2, evidence: 1, references: 1 });
  });
});

describe('source-grounded annotations', () => {
  it('keeps an exact normalized quote, section, source link, and source fingerprint', () => {
    const note = sourceAnnotationTemplate({
      createdAt: new Date('2026-08-24T12:00:00.000Z'),
      passage: { heading: '  Spread  ', text: 'Movable   type\r\nchanged copying.' },
      source: sources[0]!,
      sourceContentHash: 'c'.repeat(64),
      title: 'Notes on Print culture',
      topicSlug: 'print',
    });

    expect(note).toContain('annotation: source-quote');
    expect(note).toContain(`source_content_sha256: ${'c'.repeat(64)}`);
    expect(note).toContain('source_heading: "Spread"');
    expect(note).toContain('[[../Sources/items/one-print-culture|Print culture]]');
    expect(note).toContain('> Movable type\n> changed copying.');
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
